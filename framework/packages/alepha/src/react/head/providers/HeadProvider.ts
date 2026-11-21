import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import { SeoExpander } from "../helpers/SeoExpander.ts";
import type {
  Head,
  HeadAfterPages,
  HeadLink,
  HeadMeta,
} from "../interfaces/Head.ts";

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

  public global: Array<Head | (() => Head)> = [];

  /**
   * `$head({ afterPages })` entries, run by {@link fillHead} once every page
   * head has merged. See {@link HeadAfterPages}.
   */
  public afterPages: Array<HeadAfterPages["afterPages"]> = [];

  /**
   * Track if we've warned about page-level htmlAttributes to avoid spam.
   */
  protected warnedAboutHtmlAttributes = false;
  protected warnedAboutGlobalUrl = false;

  /**
   * Resolve global head configuration (from $head primitives only).
   *
   * This is used to get what the document starts with early, before page
   * loaders run: `htmlAttributes`, `charset` and `viewport`. Only global
   * `$head` entries can set them; page-level values are ignored for early
   * streaming optimization.
   *
   * @returns Merged global head with htmlAttributes, charset and viewport
   */
  public resolveGlobalHead(): Head {
    const head: Head = {
      // Only the answer for an app with no i18n: `alepha/react/i18n` registers
      // a global `$head` reporting the language it resolved, which lands in
      // the loop below and overrides this.
      htmlAttributes: { lang: "en" },
    };

    for (const h of this.global) {
      const resolved = typeof h === "function" ? h() : h;
      if (resolved.htmlAttributes) {
        head.htmlAttributes = {
          ...head.htmlAttributes,
          ...resolved.htmlAttributes,
        };
      }
      // The early head writes these two before any page renders: dropped
      // here, `$head({ viewport })` never reached the document.
      if (resolved.charset) {
        head.charset = resolved.charset;
      }
      if (resolved.viewport) {
        head.viewport = resolved.viewport;
      }
    }

    return head;
  }

  /**
   * Fully resolve all global $head entries (functions re-evaluated, objects kept as-is).
   *
   * Unlike resolveGlobalHead(), which keeps what the early head needs
   * (htmlAttributes, charset, viewport), this resolves all head properties
   * (title, meta, link, script, attributes).
   *
   * Used by BrowserHeadProvider.refreshGlobalHead() to re-apply global head to the DOM.
   */
  public resolveGlobal(): Head {
    const head: Head = {};

    for (const h of this.global) {
      const resolved = typeof h === "function" ? h() : h;
      const { meta, link } = this.seoExpander.expand(resolved);
      // `Object.assign` onto the accumulator rather than rebuilding it: `head`
      // is a fresh local object, and re-spreading it once per entry made the
      // merge quadratic in the number of global head sources.
      Object.assign(head, resolved, {
        meta: this.replaceMeta(this.retitleMeta(head.meta ?? [], resolved), [
          ...meta,
          ...(resolved.meta ?? []),
        ]),
        link: this.replaceLinks(head.link ?? [], [
          ...link,
          ...(resolved.link ?? []),
        ]),
        script: [...(head.script ?? []), ...(resolved.script ?? [])],
      });
    }

    head.script = this.escapeDataScripts(head.script);

    return head;
  }

  public fillHead(state: HeadState) {
    state.head = {
      ...state.head,
    };

    for (const h of this.global) {
      const head = typeof h === "function" ? h() : h;
      this.mergeHead(state, head);
      this.warnAboutGlobalUrl(head);
    }

    for (const layer of state.layers) {
      if (layer.route?.head && !layer.error) {
        this.fillHeadByPage(layer.route, state, layer.props ?? {});
      }
    }

    if (this.afterPages.length > 0) {
      const layers = state.layers.map((layer) => ({
        name: layer.name,
        params: layer.config?.params,
        error: layer.error,
      }));
      for (const after of this.afterPages) {
        const head = after({ head: state.head, layers });
        if (head) {
          this.mergeHead(state, head);
        }
      }
    }

    this.fillCanonicalUrl(state);
    this.resolveImageUrls(state);
    state.head.script = this.escapeDataScripts(state.head.script);

    // Defaults if none were set by global $head or page head. `lang` is one of
    // those defaults, not a decision: an app with i18n has already merged the
    // resolved language in above, through i18n's own global `$head`.
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
   * `og:url` and `twitter:url`, but nothing ever set it, so pages shipped
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
   * on there is nothing to say: a relative canonical is worse than none,
   * because it resolves against whichever host served it, which is precisely
   * the set of hosts being disambiguated.
   */
  protected fillCanonicalUrl(state: HeadState): void {
    if (state.head.url) {
      return;
    }

    // A canonical the author wrote as a `link` is the page's: no second
    // one, and `og:url` and `twitter:url` name the same URL, so the three
    // agree. A relative one names no URL a crawler could be given.
    const canonical = state.head.link?.findLast((it) => it.rel === "canonical");
    if (canonical) {
      if (/^https?:\/\//i.test(canonical.href)) {
        const { meta } = this.seoExpander.expand({ url: canonical.href });
        state.head.meta = this.replaceMeta(state.head.meta ?? [], meta);
      }
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
    state.head.meta = this.replaceMeta(state.head.meta ?? [], meta);
    state.head.link = this.replaceLinks(state.head.link ?? [], link);
  }

  /**
   * Make a relative `og:image` or `twitter:image` absolute.
   *
   * {@link SeoExpander} writes `image` as given, and every crawler that
   * unfurls a link (chat apps, social networks) ignores a relative image: the
   * preview shows a placeholder instead. Resolved here, against the same
   * origin as the canonical, so a head can name `/logo.png` and stay portable
   * across hosts. An absolute URL is kept as it is, and with no origin to
   * build on the tag is left alone.
   */
  protected resolveImageUrls(state: HeadState): void {
    const meta = state.head.meta;
    if (!meta?.length) {
      return;
    }

    const origin = this.resolveOrigin();
    if (!origin) {
      return;
    }

    const base = `${origin.replace(/\/$/, "")}/`;
    state.head.meta = meta.map((it) => {
      const key = it.property ?? it.name;
      if (!key || !HeadProvider.IMAGE_META.has(key) || !it.content) {
        return it;
      }
      try {
        return { ...it, content: new URL(it.content, base).href };
      } catch {
        return it;
      }
    });
  }

  /**
   * The meta tags whose content is an image URL a crawler fetches.
   */
  protected static readonly IMAGE_META = new Set([
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
  ]);

  /**
   * The site's absolute origin: `PUBLIC_URL`, or what the browser is already
   * on.
   *
   * The browser fallback is not a convenience. `fillHead` runs again on every
   * client-side transition, and `PUBLIC_URL` is a server variable that a client
   * bundle has no reason to carry, so without it the canonical the server
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
   * It is a per-page fact: declared globally it names the same URL on every
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
      "Global $head() sets `url`, which names the same canonical URL on every page: " +
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
      // Merged key by key, as `resolveGlobalHead` does for the early head:
      // spread whole, a later global head's attributes replaced the earlier
      // ones, so the browser lost i18n's `lang` the moment an app set any
      // attribute of its own, and disagreed with the server's document.
      htmlAttributes: this.mergeAttributes(
        state.head.htmlAttributes,
        head.htmlAttributes,
      ),
      bodyAttributes: this.mergeAttributes(
        state.head.bodyAttributes,
        head.bodyAttributes,
      ),
      meta: this.replaceMeta(this.retitleMeta(state.head.meta ?? [], head), [
        ...meta,
        ...(head.meta ?? []),
      ]),
      link: this.replaceLinks(state.head.link ?? [], [
        ...link,
        ...(head.link ?? []),
      ]),
      script: [...(state.head.script ?? []), ...(head.script ?? [])],
    };
  }

  /**
   * The one merge rule for meta tags, on the server and in the browser: a
   * head replaces, key by key, what the heads before it declared. A head is
   * one layer (a global `$head`, a page with its SEO fields and its `meta`
   * array, an `afterPages` head), and the tags it declares for a key replace
   * ALL the tags earlier layers declared for that key. Appended, a page with
   * a description of its own carried two `<meta name="description">`, the
   * site's first, and a search engine may quote either.
   *
   * A layer may declare several tags of one key, and all are kept, in order:
   * `og:image`, `article:tag` and `og:locale:alternate` are lists.
   */
  protected replaceMeta(inherited: HeadMeta[], meta: HeadMeta[]): HeadMeta[] {
    const keys = new Set(meta.map((it) => this.metaKey(it)));
    return [
      ...inherited.filter((it) => {
        const key = this.metaKey(it);
        return key === undefined || !keys.has(key);
      }),
      ...meta,
    ];
  }

  /**
   * What makes two meta tags the same tag: the `property` or `name`, and the
   * media query, as in the browser (`BrowserHeadProvider.renderMetaTag`). Two
   * `theme-color` tags differing by `prefers-color-scheme` are two tags.
   */
  protected metaKey(meta: HeadMeta): string | undefined {
    const key = meta.property ?? meta.name;
    return key === undefined ? undefined : `${key}\n${meta.media ?? ""}`;
  }

  /**
   * Give the social titles that follow the page title the title of a head
   * that sets one. `SeoExpander` writes `og:title` and `twitter:title` only
   * for a head with other SEO fields, so a page head of `{ title }` alone
   * left the site's title in them, and every link to the page unfurled under
   * it.
   *
   * Only a title the expander derived from an inherited `title` is replaced.
   * One the author set (`og.title`, `twitter.title`, a `meta` entry) says
   * something else than the title on purpose, and stays. Nothing is added: a
   * head with no social tags stays without.
   */
  protected retitleMeta(inherited: HeadMeta[], head: Head): HeadMeta[] {
    const title = head.title;
    if (!title) {
      return inherited;
    }
    return inherited.map((it) =>
      this.seoExpander.isDerivedTitle(it)
        ? this.seoExpander.retitle(it, title)
        : it,
    );
  }

  /**
   * Links accumulate, except the canonical, which follows the rule of the
   * meta tags: a head that declares one replaces those of the heads before
   * it. A layout and its child both naming a `url` wrote two.
   */
  protected replaceLinks(inherited: HeadLink[], link: HeadLink[]): HeadLink[] {
    if (!link.some((it) => it.rel === "canonical")) {
      return [...inherited, ...link];
    }
    return [...inherited.filter((it) => it.rel !== "canonical"), ...link];
  }

  /**
   * Make the content of a data block safe to write between `<script>` tags.
   * The HTML parser treats every script whose `type` is not JavaScript as
   * data, and ends the element at the first `</script`, whatever string it
   * sits in: a value read from a loader could close the block and open a
   * script of its own.
   *
   * - A JSON block (`application/json`, any `+json` type, `importmap`,
   *   `speculationrules`, with or without parameters) gets `<` written as its
   *   JSON escape, which parses to the same value. U+2028 and U+2029 are
   *   escaped as well, for a consumer that evaluates the block as JavaScript.
   * - Any other data block is not JSON, so only what the parser acts on is
   *   broken up, with a backslash after its `<`: `</script` always, and
   *   `<!--` where a `<script` follows it, the one case in which the parser
   *   stops seeing the closing tag. A comment in a template, or `a<!--b` in
   *   a shader, is written as given.
   *
   * Both rewrites leave their own output alone, so a renderer may apply them
   * again. Executable scripts (no `type`, `module`, a JavaScript MIME type)
   * are left as they are: no rewrite keeps their meaning.
   */
  protected escapeDataScripts(scripts: Head["script"]): Head["script"] {
    return scripts?.map((script) => {
      if (
        typeof script === "string" ||
        !script.content ||
        typeof script.type !== "string"
      ) {
        return script;
      }
      // The essence of the type: no parameter, no case.
      const type = script.type.split(";")[0].trim().toLowerCase();
      if (type === "" || type === "module" || HeadProvider.JS_TYPE.test(type)) {
        return script;
      }
      if (HeadProvider.JSON_TYPE.test(type)) {
        return {
          ...script,
          content: script.content
            .replace(/</g, "\\u003c")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029"),
        };
      }
      return {
        ...script,
        content: script.content
          .replace(/<(\/script)/gi, "<\\$1")
          .replace(/<(!--)(?=[\s\S]*<script)/gi, "<\\$1"),
      };
    });
  }

  /**
   * The script types whose content is JSON.
   */
  protected static readonly JSON_TYPE =
    /^(application\/json|[\w.-]+\/[\w.-]+\+json|importmap|speculationrules)$/;

  /**
   * The script types a browser executes, `module` aside: the JavaScript MIME
   * types, as `ServerHeadProvider.executableInlineContent` reads them.
   */
  protected static readonly JS_TYPE =
    /^(text|application)\/(x-)?(java|ecma)script$/;

  protected mergeAttributes(
    previous?: Record<string, string>,
    next?: Record<string, string>,
  ): Record<string, string> | undefined {
    if (!previous || !next) {
      return next ?? previous;
    }
    return { ...previous, ...next };
  }

  protected fillHeadByPage(
    page: HeadRoute,
    state: HeadState,
    props: Record<string, any>,
  ): void {
    if (!page.head) {
      return;
    }

    const head =
      typeof page.head === "function"
        ? page.head(props, state.head)
        : page.head;

    // Expand SEO fields into meta tags
    const { meta, link } = this.seoExpander.expand(head);
    state.head.meta = this.replaceMeta(
      this.retitleMeta(state.head.meta ?? [], head),
      [...meta, ...(head.meta ?? [])],
    );
    state.head.link = this.replaceLinks(state.head.link ?? [], [
      ...link,
      ...(head.link ?? []),
    ]);

    // Record that this page named its own URL. The expansion above already
    // emitted its canonical, so without this `fillCanonicalUrl` would see an
    // unset `url`, decide the page had none, and emit a second one.
    if (head.url) {
      state.head.url = head.url;
    }

    if (head.title) {
      if (state.head.titleSeparator) {
        state.head.title = `${head.title}${state.head.titleSeparator}${state.head.title}`;
      } else {
        state.head.title = head.title;
      }

      // Kept when the page names none: reset, the chain stopped at the
      // second page level and a child of a titled layout lost the site title.
      state.head.titleSeparator =
        head.titleSeparator ?? state.head.titleSeparator;
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
     * The page's name and matched params, handed to `$head({ afterPages })`.
     */
    name?: string;
    config?: { params?: Record<string, any> };
    /**
     * The layer's matched path, compiled by the router from the route pattern
     * and its params, so `/docs/:slug` arrives here as `/docs/getting-started`,
     * with no query string. The deepest layer's is the page's own URL path,
     * which is what {@link HeadProvider.fillCanonicalUrl} builds on.
     */
    path?: string;
  }>;
}
