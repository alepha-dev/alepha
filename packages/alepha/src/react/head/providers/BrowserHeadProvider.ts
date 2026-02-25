import { $inject, Alepha } from "alepha";
import type { Head, HeadMeta } from "../interfaces/Head.ts";
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
      this.renderHead(this.document, state.head);
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

  public renderHead(document: Document, head: Head): void {
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
        this.renderMetaTag(document, it);
      }
    }

    if (head.link) {
      for (const it of head.link) {
        const { rel, href } = it;
        let link = document.querySelector(`link[rel="${rel}"][href="${href}"]`);
        if (!link) {
          link = document.createElement("link");
          link.setAttribute("rel", rel);
          link.setAttribute("href", href);
          if (it.type) {
            link.setAttribute("type", it.type);
          }
          if (it.as) {
            link.setAttribute("as", it.as);
          }
          if (it.crossorigin != null) {
            link.setAttribute("crossorigin", "");
          }
          document.head.appendChild(link);
        }
      }
    }

    if (head.script) {
      for (const it of head.script) {
        this.renderScriptTag(document, it);
      }
    }
  }

  protected renderScriptTag(
    document: Document,
    script:
      | string
      | (Record<string, string | boolean | undefined> & { content?: string }),
  ): void {
    const el = document.createElement("script");

    // Handle plain string as inline script
    if (typeof script === "string") {
      el.textContent = script;
      document.head.appendChild(el);
      return;
    }

    const { content, ...attrs } = script;

    // For scripts with src, check if already exists
    if (attrs.src) {
      const existing = document.querySelector(`script[src="${attrs.src}"]`);
      if (existing) {
        return;
      }
    }

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

  protected renderMetaTag(document: Document, meta: HeadMeta): void {
    const { content } = meta;

    // Handle OpenGraph tags (property attribute)
    if (meta.property) {
      const existing = document.querySelector(
        `meta[property="${meta.property}"]`,
      );
      if (existing) {
        existing.setAttribute("content", content);
      } else {
        const newMeta = document.createElement("meta");
        newMeta.setAttribute("property", meta.property);
        newMeta.setAttribute("content", content);
        document.head.appendChild(newMeta);
      }
      return;
    }

    // Handle standard meta tags (name attribute)
    if (meta.name) {
      const existing = document.querySelector(`meta[name="${meta.name}"]`);
      if (existing) {
        existing.setAttribute("content", content);
      } else {
        const newMeta = document.createElement("meta");
        newMeta.setAttribute("name", meta.name);
        newMeta.setAttribute("content", content);
        document.head.appendChild(newMeta);
      }
    }
  }
}
