import { $inject, Alepha } from "alepha";
import { TrustedTypes } from "alepha/react";

import type { Head, HeadLink, HeadMeta } from "../interfaces/Head.ts";
import { HeadProvider } from "./HeadProvider.ts";

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

  /**
   * Marks a meta/link tag as owned by the router's head reconciliation.
   */
  protected static readonly MANAGED_ATTRIBUTE = "data-alepha-head";

  /**
   * The layers of the page on screen, kept so {@link refreshGlobalHead} can
   * fill the head again with the page's own on top.
   */
  protected layers?: Array<any>;

  /**
   * The `<body>` and `<html>` attributes the last reconciled pass set: the
   * ones a later pass may remove. An attribute set by anything else (a theme
   * script, a browser extension) is never in here.
   */
  protected managedAttributes = {
    body: new Set<string>(),
    html: new Set<string>(),
  };

  /**
   * The `class` tokens the last reconciled pass added to `<body>` and
   * `<html>`. `class` is a list several writers share (a theme script's
   * `dark`, a sidebar's state), so it is owned token by token, never whole.
   */
  protected managedClasses = {
    body: new Set<string>(),
    html: new Set<string>(),
  };

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

    this.layers = state.layers;
    this.headProvider.fillHead(state);
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
   * (e.g., theme switch). The head of the page on screen stays on top: the
   * head is filled again from the global entries and that page's layers, as a
   * navigation to the same page would. Before any page has rendered, the
   * global head is applied alone.
   */
  public refreshGlobalHead(): void {
    if (!this.layers) {
      this.renderHead(this.document, this.headProvider.resolveGlobal());
      return;
    }

    const state = { head: {} as Head, layers: this.layers };
    this.headProvider.fillHead(state);
    this.renderHead(this.document, state.head, { reconcile: true });
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
        // `media` is added only when the tag carries one: a plain tag reads
        // back as `{ name, content }`, never `{ name, content, media:
        // undefined }`. The two are not the same to `toContainEqual`, nor to
        // anything else comparing these by value.
        // Get meta tags with name attribute
        for (const meta of document.head.querySelectorAll("meta[name]")) {
          const name = meta.getAttribute("name");
          const content = meta.getAttribute("content");
          const media = meta.getAttribute("media");
          if (name && content) {
            metas.push(media ? { name, content, media } : { name, content });
          }
        }
        // Get meta tags with property attribute (OpenGraph)
        for (const meta of document.head.querySelectorAll("meta[property]")) {
          const property = meta.getAttribute("property");
          const content = meta.getAttribute("content");
          const media = meta.getAttribute("media");
          if (property && content) {
            metas.push(
              media ? { property, content, media } : { property, content },
            );
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
    // Every meta/link this pass renders, created or updated in place. In
    // reconcile mode it becomes the new set of managed tags; anything
    // previously managed and absent from it is stale and gets removed.
    const rendered = options?.reconcile ? new Set<Element>() : undefined;

    if (head.title) {
      document.title = head.title;
    }

    this.renderAttributes(
      document.body,
      head.bodyAttributes,
      options?.reconcile ? "body" : undefined,
    );
    this.renderAttributes(
      document.documentElement,
      head.htmlAttributes,
      options?.reconcile ? "html" : undefined,
    );

    if (head.meta) {
      // A key may come several times (`og:image`, `article:tag`): the nth
      // tag of a key in the head is the nth element of that key.
      const seen = new Map<string, number>();
      for (const it of head.meta) {
        const key = `${it.property ? "p" : "n"}\n${it.property ?? it.name}\n${it.media ?? ""}`;
        const index = seen.get(key) ?? 0;
        seen.set(key, index + 1);
        const el = this.renderMetaTag(document, it, index);
        if (el) {
          rendered?.add(el);
        }
      }
    }

    if (head.link) {
      for (const it of head.link) {
        // Render FIRST, then record. `rendered?.add(this.renderLinkTag(…))`
        // reads as equivalent and is not: optional chaining short-circuits
        // the whole chain, arguments included, so outside reconcile mode -
        // `useHead({ link })` and `refreshGlobalHead()`, i.e. every
        // canonical, preload, hreflang and theme-aware favicon set from the
        // client - the tag was never built at all.
        const el = this.renderLinkTag(document, it);
        rendered?.add(el);
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
   * Write `attributes` on `<body>` or `<html>`. With `owner` (a reconciled
   * pass), an attribute the previous pass set and this one does not is
   * removed: a page's `bodyAttributes` must not follow the reader to the next
   * page, where a hard load would not have them. `class` is reconciled token
   * by token, so a class another script put there stays.
   */
  protected renderAttributes(
    el: Element,
    attributes: Record<string, string> | undefined,
    owner: "body" | "html" | undefined,
  ): void {
    const set = new Set<string>();
    for (const [key, value] of Object.entries(attributes ?? {})) {
      if (owner && key === "class") {
        continue;
      }
      if (value) {
        el.setAttribute(key, value);
        set.add(key);
      } else {
        el.removeAttribute(key);
      }
    }

    if (!owner) {
      return;
    }

    const managed = this.managedAttributes[owner];
    for (const key of managed) {
      if (!set.has(key)) {
        el.removeAttribute(key);
      }
    }
    managed.clear();
    for (const key of set) {
      managed.add(key);
    }

    const classes = this.managedClasses[owner];
    const tokens = (attributes?.class ?? "").split(/\s+/).filter(Boolean);
    for (const token of classes) {
      if (!tokens.includes(token)) {
        el.classList.remove(token);
      }
    }
    classes.clear();
    for (const token of tokens) {
      el.classList.add(token);
      classes.add(token);
    }
    if (el.classList.length === 0) {
      el.removeAttribute("class");
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
    for (const el of document.head.querySelectorAll(
      `[${BrowserHeadProvider.MANAGED_ATTRIBUTE}]`,
    )) {
      if (!rendered.has(el)) {
        el.remove();
      }
    }

    for (const el of rendered) {
      el.setAttribute(BrowserHeadProvider.MANAGED_ATTRIBUTE, "");
    }
  }

  protected renderLinkTag(document: Document, link: HeadLink): Element {
    const { rel, href } = link;
    const existing = document.querySelector(
      `link[rel=${this.quote(rel)}][href=${this.quote(href)}]`,
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
      el.setAttribute(
        "crossorigin",
        link.crossorigin === true ? "" : link.crossorigin,
      );
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
    if (link.integrity) {
      el.setAttribute("integrity", link.integrity);
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
      this.applyNonce(document, el);
      el.textContent = TrustedTypes.script(script);
      document.head.appendChild(el);
      return;
    }

    const { content, ...attrs } = script;

    // src-based scripts: dedupe by src attribute (existing behaviour).
    if (attrs.src) {
      if (
        document.querySelector(`script[src=${this.quote(String(attrs.src))}]`)
      ) {
        return;
      }
    } else if (typeof attrs.id === "string") {
      // id-based dedupe: single source of truth per id.
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
        // A script's `src` is a Trusted Types sink.
        el.setAttribute(
          key,
          key === "src" ? TrustedTypes.scriptURL(String(value)) : String(value),
        );
      }
    }
    if (content) {
      this.applyNonce(document, el);
      el.textContent = TrustedTypes.script(content);
    }
    document.head.appendChild(el);
  }

  /**
   * Give an inline script the document's CSP nonce, when the server sent
   * one: a head script a client navigation inserts is checked against the
   * policy of the document, and only that nonce (or its hash) allows it.
   *
   * The server writes the nonce on `#__ssr_private` of every rendered page.
   * A browser hides the attribute's value once parsed, so it is read from the
   * `nonce` property. A page answered from the page cache has none, and
   * there only the hashed scripts run.
   */
  protected applyNonce(document: Document, el: HTMLScriptElement): void {
    const nonce = (
      document.querySelector("script[nonce]") as HTMLScriptElement | null
    )?.nonce;
    if (nonce) {
      el.nonce = nonce;
    }
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

  /**
   * An attribute value as a quoted CSS string, for a selector. A value is
   * free text (a data URI `href`, a media query), and written raw a quote or
   * a backslash in it made the selector invalid: `querySelector` threw, on
   * hydration and on every navigation.
   */
  protected quote(value: string): string {
    return `"${CSS.escape(value)}"`;
  }

  protected renderMetaTag(
    document: Document,
    meta: HeadMeta,
    index = 0,
  ): Element | undefined {
    const { content } = meta;

    const key = meta.property
      ? `property=${this.quote(meta.property)}`
      : meta.name
        ? `name=${this.quote(meta.name)}`
        : undefined;

    if (!key) {
      return undefined;
    }

    // The identity of a meta tag is its name/property AND its media query, not
    // the name alone. Two `theme-color` tags differing only by
    // `prefers-color-scheme` are two tags, and matching on the name would make
    // the second overwrite the first, leaving one tag whose media query no
    // longer matches the colour it carries.
    //
    // `:not([media])` on the unqualified side is the other half of that: a
    // plain tag must not adopt a media-qualified one it happens to find first.
    const existing = document.querySelectorAll(
      meta.media
        ? `meta[${key}][media=${this.quote(meta.media)}]`
        : `meta[${key}]:not([media])`,
    )[index];

    if (existing) {
      existing.setAttribute("content", content);
      return existing;
    }

    const newMeta = document.createElement("meta");
    if (meta.property) {
      newMeta.setAttribute("property", meta.property);
    } else if (meta.name) {
      newMeta.setAttribute("name", meta.name);
    }
    newMeta.setAttribute("content", content);
    if (meta.media) {
      newMeta.setAttribute("media", meta.media);
    }
    document.head.appendChild(newMeta);
    return newMeta;
  }
}

export interface RenderHeadOptions {
  /**
   * Treat `head` as the complete set of page-owned meta/link tags: mark what
   * it renders as managed and remove any tag managed by an earlier pass that
   * it does not re-declare.
   *
   * On (navigation), the DOM ends up matching what a hard load of the same URL
   * would produce, `<body>` and `<html>` attributes included. Off (the
   * default, used by `useHead`), the call only adds and updates: a partial
   * head must never be read as "everything else is stale".
   */
  reconcile?: boolean;
}
