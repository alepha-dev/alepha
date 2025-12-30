import { $hook, $inject } from "alepha";
import { ServerTimingProvider } from "alepha/server";
import type { HeadMeta, SimpleHead } from "../interfaces/Head.ts";
import { HeadProvider } from "./HeadProvider.ts";

export class ServerHeadProvider {
  protected readonly headProvider = $inject(HeadProvider);
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);

  protected readonly onServerRenderEnd = $hook({
    on: "react:server:render:end",
    handler: async (ev) => {
      this.serverTimingProvider.beginTiming("renderHead");
      this.headProvider.fillHead(ev.state);
      if (ev.state.head) {
        ev.html = this.renderHead(ev.html, ev.state.head);
      }
      this.serverTimingProvider.endTiming("renderHead");
    },
  });

  public renderHead(template: string, head: SimpleHead): string {
    let result = template;

    // Inject htmlAttributes
    const htmlAttributes = head.htmlAttributes;
    if (htmlAttributes) {
      result = result.replace(
        /<html([^>]*)>/i,
        (_, existingAttrs) =>
          `<html${this.mergeAttributes(existingAttrs, htmlAttributes)}>`,
      );
    }

    // Inject bodyAttributes
    const bodyAttributes = head.bodyAttributes;
    if (bodyAttributes) {
      result = result.replace(
        /<body([^>]*)>/i,
        (_, existingAttrs) =>
          `<body${this.mergeAttributes(existingAttrs, bodyAttributes)}>`,
      );
    }

    // Build head content
    let headContent = "";
    const title = head.title;
    if (title) {
      if (template.includes("<title>")) {
        result = result.replace(
          /<title>(.*?)<\/title>/i,
          () => `<title>${this.escapeHtml(title)}</title>`,
        );
      } else {
        headContent += `<title>${this.escapeHtml(title)}</title>\n`;
      }
    }

    if (head.meta) {
      for (const meta of head.meta) {
        headContent += this.renderMetaTag(meta);
      }
    }

    if (head.link) {
      for (const link of head.link) {
        headContent += `<link rel="${this.escapeHtml(link.rel)}" href="${this.escapeHtml(link.href)}">\n`;
      }
    }

    // Inject into <head>...</head>
    result = result.replace(
      /<head([^>]*)>(.*?)<\/head>/is,
      (_, existingAttrs, existingHead) =>
        `<head${existingAttrs}>${existingHead}${headContent}</head>`,
    );

    return result.trim();
  }

  protected mergeAttributes(
    existing: string,
    attrs: Record<string, string>,
  ): string {
    const existingAttrs = this.parseAttributes(existing);
    const merged = { ...existingAttrs, ...attrs };
    return Object.entries(merged)
      .map(([k, v]) => ` ${k}="${this.escapeHtml(v)}"`)
      .join("");
  }

  protected parseAttributes(attrStr: string): Record<string, string> {
    attrStr = attrStr.replaceAll("'", '"');

    const attrs: Record<string, string> = {};
    const attrRegex = /([^\s=]+)(?:="([^"]*)")?/g;
    let match: RegExpExecArray | null = attrRegex.exec(attrStr);

    while (match) {
      attrs[match[1]] = match[2] ?? "";
      match = attrRegex.exec(attrStr);
    }

    return attrs;
  }

  protected escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  protected renderMetaTag(meta: HeadMeta): string {
    // OpenGraph tags use property attribute
    if (meta.property) {
      return `<meta property="${this.escapeHtml(meta.property)}" content="${this.escapeHtml(meta.content)}">\n`;
    }
    // Standard meta tags use name attribute
    if (meta.name) {
      return `<meta name="${this.escapeHtml(meta.name)}" content="${this.escapeHtml(meta.content)}">\n`;
    }
    return "";
  }
}
