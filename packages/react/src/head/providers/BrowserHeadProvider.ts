import { $hook, $inject } from "alepha";
import type { Head, HeadMeta } from "../interfaces/Head.ts";
import { HeadProvider } from "./HeadProvider.ts";

export class BrowserHeadProvider {
  protected readonly headProvider = $inject(HeadProvider);

  protected get document(): Document {
    return window.document;
  }

  protected readonly onBrowserRender = $hook({
    on: "react:browser:render",
    handler: async ({ state }) => {
      this.headProvider.fillHead(state);
      if (state.head) {
        this.renderHead(this.document, state.head);
      }
    },
  });

  protected readonly onTransitionEnd = $hook({
    on: "react:transition:end",
    handler: async ({ state }) => {
      this.headProvider.fillHead(state);
      if (state.head) {
        this.renderHead(this.document, state.head);
      }
    },
  });

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
          document.head.appendChild(link);
        }
      }
    }
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
