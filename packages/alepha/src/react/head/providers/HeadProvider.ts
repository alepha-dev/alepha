import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { SeoExpander } from "../helpers/SeoExpander.ts";
import type { Head } from "../interfaces/Head.ts";

/**
 * Provides methods to fill and merge head information into the application state.
 *
 * Used both on server and client side to manage document head.
 *
 * @see {@link SeoExpander}
 * @see {@link ServerHeadProvider}
 * @see {@link BrowserHeadProvider}
 */
export class HeadProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly seoExpander = $inject(SeoExpander);

  public global?: Array<Head | (() => Head)> = [];

  /**
   * Track if we've warned about page-level htmlAttributes to avoid spam.
   */
  protected warnedAboutHtmlAttributes = false;
  protected warnedAboutGlobalUrl = false;

  /**
   * Resolve global head configuration (from $head primitives only).
   *
   * This is used to get htmlAttributes early, before page loaders run.
   * Only htmlAttributes from global $head are allowed; page-level htmlAttributes
   * are ignored for early streaming optimization.
   *
   * @returns Merged global head with htmlAttributes
   */
  public resolveGlobalHead(): Head {
    const head: Head = {
      htmlAttributes: { lang: "en" },
    };

    for (const h of this.global ?? []) {
      const resolved = typeof h === "function" ? h() : h;
      if (resolved.htmlAttributes) {
        head.htmlAttributes = {
          ...head.htmlAttributes,
          ...resolved.htmlAttributes,
        };
      }
    }

    return head;
  }

  /**
   * Fully resolve all global $head entries (functions re-evaluated, objects kept as-is).
   *
   * Unlike resolveGlobalHead() which only extracts htmlAttributes for streaming,
   * this resolves all head properties (meta, link, script, htmlAttributes, etc.).
   *
   * Used by BrowserHeadProvider.refreshGlobalHead() to re-apply global head to the DOM.
   */
  public resolveGlobal(): Head {
    let head: Head = {};

    for (const h of this.global ?? []) {
      const resolved = typeof h === "function" ? h() : h;
      const { meta, link } = this.seoExpander.expand(resolved);
      head = {
        ...head,
        ...resolved,
        meta: [...(head.meta ?? []), ...meta, ...(resolved.meta ?? [])],
        link: [...(head.link ?? []), ...link, ...(resolved.link ?? [])],
        script: [...(head.script ?? []), ...(resolved.script ?? [])],
      };
    }

    return head;
  }

  public fillHead(state: HeadState) {
    state.head = {
      ...state.head,
    };

    for (const h of this.global ?? []) {
      const head = typeof h === "function" ? h() : h;
      this.mergeHead(state, head);
      this.warnAboutGlobalUrl(head);
    }

    for (const layer of state.layers) {
      if (layer.route?.head && !layer.error) {
        this.fillHeadByPage(layer.route, state, layer.props ?? {});
      }
    }

    this.fillCanonicalUrl(state);

    // Defaults if none were set by global $head or page head
    state.head.title ??= "App";
    state.head.htmlAttributes = {
      lang: "en",
      ...state.head.htmlAttributes,
    };
  }

  /**
   * Give the page its own absolute URL when nothing else did.
   *
   * {@link SeoExpander} already turns `head.url` into `<link rel="canonical">`,
   * `og:url` and `twitter:url` — but nothing ever set it, so pages shipped
   * OpenGraph tags with no `og:url` and no canonical at all. Every URL that
   * reaches the same content was then equally authoritative to a crawler:
   * a second hostname serving the same build, `?utm_source=…` variants, a
   * trailing slash. Search engines pick one by guessing, and split the ranking
   * signal across the rest.
   *
   * Filled from the **matched route path** rather than from the request URL,
   * which is the whole point and the easy thing to get wrong: building it from
   * `location.href` bakes the query string into the canonical, so
   * `?utm_source=twitter` becomes its own authoritative page and the tag
   * certifies the duplication it exists to collapse. Layer paths are compiled
   * by the router from the route pattern and its params, so they carry no query
   * string and a normalised slash.
   *
   * Skipped rather than guessed when the answer would be wrong: a wildcard or
   * `/404` route has no single URL it could name, an error layer means the page
   * being shown is not the page that was asked for, and with no origin to build
   * on there is nothing to say — a relative canonical is worse than none,
   * because it resolves against whichever host served it, which is precisely
   * the set of hosts being disambiguated.
   */
  protected fillCanonicalUrl(state: HeadState): void {
    if (state.head.url) {
      return;
    }

    const origin = this.resolveOrigin();
    if (!origin) {
      return;
    }

    if (state.layers.some((layer) => layer.error)) {
      return;
    }

    const path = state.layers.at(-1)?.path;
    if (path === undefined || path.includes("*") || path === "/404") {
      return;
    }

    const url = `${origin.replace(/\/$/, "")}${path || "/"}`;
    state.head.url = url;

    // Back through the expander rather than pushing three tags by hand, so
    // an auto-filled URL and an author-supplied one produce the same markup.
    const { meta, link } = this.seoExpander.expand({ url });
    state.head.meta = [...(state.head.meta ?? []), ...meta];
    state.head.link = [...(state.head.link ?? []), ...link];
  }

  /**
   * The site's absolute origin: `PUBLIC_URL`, or what the browser is already
   * on.
   *
   * The browser fallback is not a convenience. `fillHead` runs again on every
   * client-side transition, and `PUBLIC_URL` is a server variable that a client
   * bundle has no reason to carry — so without it the canonical the server
   * rendered would be dropped by the browser's head reconciliation on the first
   * navigation, leaving the tag present on a cold load and absent everywhere
   * else. `location.origin` is the same answer the server would have given.
   */
  protected resolveOrigin(): string | undefined {
    const configured = this.alepha.env.PUBLIC_URL;
    if (configured) {
      return String(configured);
    }
    if (typeof location !== "undefined" && location.origin) {
      return location.origin;
    }
    return undefined;
  }

  /**
   * A global `url` is almost always a mistake, and a silent one.
   *
   * It is a per-page fact — declared globally it names the same URL on every
   * page, so every page tells crawlers the real version of it lives at the
   * homepage, and they are dropped from the index. That is strictly worse than
   * the missing tag it was meant to fix, and nothing about the page looks
   * wrong afterwards.
   */
  protected warnAboutGlobalUrl(head: Head): void {
    if (!head.url || this.warnedAboutGlobalUrl) {
      return;
    }
    this.warnedAboutGlobalUrl = true;
    this.log.warn(
      "Global $head() sets `url`, which names the same canonical URL on every page — " +
        "search engines read that as every page being a duplicate of that one. " +
        "Set `url` in a page's own head, or leave it unset: it is filled from PUBLIC_URL " +
        "and the matched route path.",
    );
  }

  protected mergeHead(state: HeadState, head: Head): void {
    // Expand SEO fields into meta tags
    const { meta, link } = this.seoExpander.expand(head);
    state.head = {
      ...state.head,
      ...head,
      meta: [...(state.head.meta ?? []), ...meta, ...(head.meta ?? [])],
      link: [...(state.head.link ?? []), ...link, ...(head.link ?? [])],
      script: [...(state.head.script ?? []), ...(head.script ?? [])],
    };
  }

  protected fillHeadByPage(
    page: HeadRoute,
    state: HeadState,
    props: Record<string, any>,
  ): void {
    if (!page.head) {
      return;
    }

    state.head ??= {};

    const head =
      typeof page.head === "function"
        ? page.head(props, state.head)
        : page.head;

    // Expand SEO fields into meta tags
    const { meta, link } = this.seoExpander.expand(head);
    state.head.meta = [...(state.head.meta ?? []), ...meta];
    state.head.link = [...(state.head.link ?? []), ...link];

    // Record that this page named its own URL. The expansion above already
    // emitted its canonical, so without this `fillCanonicalUrl` would see an
    // unset `url`, decide the page had none, and emit a second one.
    if (head.url) {
      state.head.url = head.url;
    }

    if (head.title) {
      state.head ??= {};

      if (state.head.titleSeparator) {
        state.head.title = `${head.title}${state.head.titleSeparator}${state.head.title}`;
      } else {
        state.head.title = head.title;
      }

      state.head.titleSeparator = head.titleSeparator;
    }

    // htmlAttributes from pages are ignored for early streaming optimization.
    // Only global $head can set htmlAttributes.
    if (head.htmlAttributes && !this.warnedAboutHtmlAttributes) {
      this.warnedAboutHtmlAttributes = true;
      this.log.warn(
        "Page-level htmlAttributes are ignored. Use global $head() for htmlAttributes instead, " +
          "as they are sent before page loaders run for early streaming optimization.",
      );
    }

    if (head.bodyAttributes) {
      state.head.bodyAttributes = {
        ...state.head.bodyAttributes,
        ...head.bodyAttributes,
      };
    }

    if (head.meta) {
      state.head.meta = [...(state.head.meta ?? []), ...(head.meta ?? [])];
    }

    if (head.link) {
      state.head.link = [...(state.head.link ?? []), ...(head.link ?? [])];
    }

    if (head.script) {
      state.head.script = [
        ...(state.head.script ?? []),
        ...(head.script ?? []),
      ];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Minimal route interface for head processing.
 * Avoids circular dependency with alepha/react/router.
 */
interface HeadRoute {
  head?: Head | ((props: Record<string, any>, previous?: Head) => Head);
}

/**
 * Minimal state interface for head processing.
 * Avoids circular dependency with alepha/react/router.
 */
interface HeadState {
  head: Head;
  layers: Array<{
    route?: HeadRoute;
    props?: Record<string, any>;
    error?: Error;
    /**
     * The layer's matched path, compiled by the router from the route pattern
     * and its params — so `/docs/:slug` arrives here as `/docs/getting-started`,
     * with no query string. The deepest layer's is the page's own URL path,
     * which is what {@link HeadProvider.fillCanonicalUrl} builds on.
     */
    path?: string;
  }>;
}
