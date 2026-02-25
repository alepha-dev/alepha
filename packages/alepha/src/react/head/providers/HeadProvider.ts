import { $inject } from "alepha";
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
  protected readonly seoExpander = $inject(SeoExpander);

  public global?: Array<Head | (() => Head)> = [];

  /**
   * Track if we've warned about page-level htmlAttributes to avoid spam.
   */
  protected warnedAboutHtmlAttributes = false;

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
    }

    for (const layer of state.layers) {
      if (layer.route?.head && !layer.error) {
        this.fillHeadByPage(layer.route, state, layer.props ?? {});
      }
    }

    // Defaults if none were set by global $head or page head
    state.head.title ??= "App";
    state.head.htmlAttributes = {
      lang: "en",
      ...state.head.htmlAttributes,
    };
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
  }>;
}
