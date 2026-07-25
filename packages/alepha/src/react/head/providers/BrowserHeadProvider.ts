import { $inject, Alepha } from "alepha";
import type { Head, HeadLink, HeadMeta } from "../interfaces/Head.ts";
import { HeadProvider } from "./HeadProvider.ts";

/**
 * Marks a meta/link tag as owned by the router's head reconciliation.
 */
const MANAGED_ATTRIBUTE = "data-alepha-head";

/**
 * Browser-side head provider that manages document head elements.
 *
 * Used by ReactBrowserProvider and ReactBrowserRouterProvider to update
 * document title, meta tags, and other head elements during client-side
 * navigation.
 */
export class BrowserHeadProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly headProvider = $inject(HeadProvider);

  protected get document(): Document {
    return window.document;
  }

  /**
   * Fill head state from route configurations and render to document.
   * Combines fillHead from HeadProvider with renderHead to the DOM.
   *
   * Only runs in browser environment - no-op on server.
   */
  public fillAndRenderHead(state: { head: Head; layers: Array<any> }): void {
    // Skip on server-side
    if (!this.alepha.isBrowser()) {
      return;
    }

    this.headProvider.fillHead(state as any);
    if (state.head) {
      // `reconcile`: a navigation replaces the page's head wholesale, so tags
      // the previous page declared and this one does not must go. Hydration
      // goes through here too, which is how server-rendered tags become
      // managed in the first place.
      this.renderHead(this.document, state.head, { reconcile: true });
    }
  }

  /**
   * Re-evaluate all global $head entries and apply the result to the DOM.
   *
   * Call this when something that affects global $head output changes at runtime
   * (e.g., theme switch). Page-level head (title, meta from routes) is not touched.
   */
  public refreshGlobalHead(): void {
    const head = this.headProvider.resolveGlobal();
    this.renderHead(this.document, head);
  }

  public getHead(document: Document): Head {
    return {
      get title() {
        return document.title;
      },
      get htmlAttributes() {
        const attrs: Record<string, string> = {};
        for (const attr of document.documentElement.attributes) {
          attrs[attr.name] = attr.value;
        }
        return attrs;
      },
      get bodyAttributes() {
        const attrs: Record<string, string> = {};
        for (const attr of document.body.attributes) {
          attrs[attr.name] = attr.value;
        }
        return attrs;
      },
      get meta() {
        const metas: HeadMeta[] = [];
        // Get meta tags with name attribute
        for (const meta of document.head.querySelectorAll("meta[name]")) {
          const name = meta.getAttribute("name");
          const content = meta.getAttribute("content");
          if (name && content) {
            metas.push({ name, content });
          }
        }
        // Get meta tags with property attribute (OpenGraph)
        for (const meta of document.head.querySelectorAll("meta[property]")) {
          const property = meta.getAttribute("property");
          const content = meta.getAttribute("content");
          if (property && content) {
            metas.push({ property, content });
          }
        }
        return metas;
      },
    };
  }

  public renderHead(
    document: Document,
    head: Head,
    options?: RenderHeadOptions,
  ): void {
    // Every meta/link this pass renders — created or updated in place. In
    // reconcile mode it becomes the new set of managed tags; anything
    // previously managed and absent from it is stale and gets removed.
    const rendered = options?.reconcile ? new Set<Element>() : undefined;

    if (head.title) {
      document.title = head.title;
    }

    if (head.bodyAttributes) {
      for (const [key, value] of Object.entries(head.bodyAttributes)) {
        if (value) {
          document.body.setAttribute(key, value);
        } else {
          document.body.removeAttribute(key);
        }
      }
    }

    if (head.htmlAttributes) {
      for (const [key, value] of Object.entries(head.htmlAttributes)) {
        if (value) {
          document.documentElement.setAttribute(key, value);
        } else {
          document.documentElement.removeAttribute(key);
        }
      }
    }

    if (head.meta) {
      for (const it of head.meta) {
        const el = this.renderMetaTag(document, it);
        if (el) {
          rendered?.add(el);
        }
      }
    }

    if (head.link) {
      for (const it of head.link) {
        rendered?.add(this.renderLinkTag(document, it));
      }
    }

    if (head.script) {
      for (const it of head.script) {
        this.renderScriptTag(document, it);
      }
    }

    if (rendered) {
      this.reconcile(document, rendered);
    }
  }

  /**
   * Remove every previously-managed meta/link that this pass did not render,
   * and mark the ones it did.
   *
   * Scripts are deliberately out of scope: they have side effects, may have
   * already executed, and re-adding one on a later navigation is not
   * equivalent to leaving it in place.
   */
  protected reconcile(document: Document, rendered: Set<Element>): void {
    for (const el of document.head.querySelectorAll(`[${MANAGED_ATTRIBUTE}]`)) {
      if (!rendered.has(el)) {
        el.remove();
      }
    }

    for (const el of rendered) {
      el.setAttribute(MANAGED_ATTRIBUTE, "");
    }
  }

  protected renderLinkTag(document: Document, link: HeadLink): Element {
    const { rel, href } = link;
    const existing = document.querySelector(
      `link[rel="${rel}"][href="${href}"]`,
    );
    if (existing) {
      return existing;
    }

    const el = document.createElement("link");
    el.setAttribute("rel", rel);
    el.setAttribute("href", href);
    if (link.type) {
      el.setAttribute("type", link.type);
    }
    if (link.as) {
      el.setAttribute("as", link.as);
    }
    if (link.crossorigin != null) {
      el.setAttribute("crossorigin", "");
    }
    if (link.media) {
      el.setAttribute("media", link.media);
    }
    if (link.sizes) {
      el.setAttribute("sizes", link.sizes);
    }
    if (link.hreflang) {
      el.setAttribute("hreflang", link.hreflang);
    }
    document.head.appendChild(el);
    return el;
  }

  protected renderScriptTag(
    document: Document,
    script:
      | string
      | (Record<string, string | boolean | undefined> & { content?: string }),
  ): void {
    // Plain string → inline script. Dedupe by exact content match against
    // any existing inline script (handles SSR-emitted globals that would
    // otherwise be re-appended on hydration).
    if (typeof script === "string") {
      if (this.findInlineScriptByContent(document, script)) return;
      const el = document.createElement("script");
      el.textContent = script;
      document.head.appendChild(el);
      return;
    }

    const { content, ...attrs } = script;

    // src-based scripts: dedupe by src attribute (existing behaviour).
    if (attrs.src) {
      if (document.querySelector(`script[src="${attrs.src}"]`)) return;
    } else if (typeof attrs.id === "string") {
      // id-based dedupe — single source of truth per id.
      if (document.querySelector(`script#${CSS.escape(attrs.id)}`)) return;
    } else if (content) {
      // Inline scripts with `content` and no src/id: fall back to content match.
      if (this.findInlineScriptByContent(document, content)) return;
    }

    const el = document.createElement("script");
    for (const [key, value] of Object.entries(attrs)) {
      if (value === true) {
        el.setAttribute(key, "");
      } else if (value !== undefined && value !== false) {
        el.setAttribute(key, String(value));
      }
    }
    if (content) {
      el.textContent = content;
    }
    document.head.appendChild(el);
  }

  /**
   * Find an existing inline `<script>` tag (no `src`) with matching textContent.
   * Used to make `renderScriptTag` idempotent across hydration + navigation,
   * so SSR-emitted global scripts aren't re-appended client-side.
   */
  protected findInlineScriptByContent(
    document: Document,
    content: string,
  ): Element | null {
    for (const existing of document.head.querySelectorAll(
      "script:not([src])",
    )) {
      if (existing.textContent === content) return existing;
    }
    return null;
  }

  protected renderMetaTag(
    document: Document,
    meta: HeadMeta,
  ): Element | undefined {
    const { content } = meta;

    // Handle OpenGraph tags (property attribute)
    if (meta.property) {
      const existing = document.querySelector(
        `meta[property="${meta.property}"]`,
      );
      if (existing) {
        existing.setAttribute("content", content);
        return existing;
      }
      const newMeta = document.createElement("meta");
      newMeta.setAttribute("property", meta.property);
      newMeta.setAttribute("content", content);
      document.head.appendChild(newMeta);
      return newMeta;
    }

    // Handle standard meta tags (name attribute)
    if (meta.name) {
      const existing = document.querySelector(`meta[name="${meta.name}"]`);
      if (existing) {
        existing.setAttribute("content", content);
        return existing;
      }
      const newMeta = document.createElement("meta");
      newMeta.setAttribute("name", meta.name);
      newMeta.setAttribute("content", content);
      document.head.appendChild(newMeta);
      return newMeta;
    }

    return undefined;
  }
}

export interface RenderHeadOptions {
  /**
   * Treat `head` as the complete set of page-owned meta/link tags: mark what
   * it renders as managed and remove any tag managed by an earlier pass that
   * it does not re-declare.
   *
   * On (navigation), the DOM ends up matching what a hard load of the same URL
   * would produce. Off (the default, used by `refreshGlobalHead`), the call
   * only adds and updates — a partial head must never be read as "everything
   * else is stale".
   */
  reconcile?: boolean;
}
