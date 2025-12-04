import { $hook, $inject } from "alepha";
import type { Head } from "../interfaces/Head.ts";
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
        const metas: { name: string; content: string }[] = [];
        for (const meta of document.head.querySelectorAll("meta[name]")) {
          const name = meta.getAttribute("name");
          const content = meta.getAttribute("content");
          if (name && content) {
            metas.push({ name, content });
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
        const { name, content } = it;
        const meta = document.querySelector(`meta[name="${name}"]`);
        if (meta) {
          meta.setAttribute("content", content);
        } else {
          const newMeta = document.createElement("meta");
          newMeta.setAttribute("name", name);
          newMeta.setAttribute("content", content);
          document.head.appendChild(newMeta);
        }
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
}
