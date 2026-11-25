import { $inject } from "alepha";

import { NotificationHtmlEscaper } from "./NotificationHtmlEscaper.ts";

/**
 * An agent's reply, Markdown, as an email's HTML (#Q4278). Small on purpose:
 * headings, paragraphs, lists, fenced code, bold, italic, inline code and
 * links. Every text is escaped first, so nothing the agent wrote reaches the
 * mail as markup of its own; a link keeps only an `http(s)` address.
 */
export class ReplyMarkdownHtml {
  protected readonly escaper = $inject(NotificationHtmlEscaper);

  public render(markdown: string): string {
    const out: string[] = [];
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | undefined;
    let code: string[] | undefined;
    const flushParagraph = () => {
      if (paragraph.length) {
        out.push(
          `<p style="margin: 0 0 12px;">${this.inline(paragraph.join(" "))}</p>`,
        );
        paragraph = [];
      }
    };
    const flushList = () => {
      if (list) {
        const tag = list.ordered ? "ol" : "ul";
        out.push(
          `<${tag} style="margin: 0 0 12px; padding-left: 20px;">${list.items
            .map((item) => `<li>${this.inline(item)}</li>`)
            .join("")}</${tag}>`,
        );
        list = undefined;
      }
    };
    for (const line of lines) {
      if (code) {
        if (line.trim().startsWith("```")) {
          out.push(
            `<pre style="margin: 0 0 12px; padding: 8px; background: #f3f4f6; border-radius: 4px; white-space: pre-wrap;">${this.escaper.escape(code.join("\n"))}</pre>`,
          );
          code = undefined;
        } else {
          code.push(line);
        }
        continue;
      }
      if (line.trim().startsWith("```")) {
        flushParagraph();
        flushList();
        code = [];
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(heading[1]!.length + 1, 6);
        out.push(
          `<h${level} style="margin: 16px 0 8px;">${this.inline(heading[2]!)}</h${level}>`,
        );
        continue;
      }
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        flushParagraph();
        const ordered = !bullet;
        if (list && list.ordered !== ordered) flushList();
        list ??= { ordered, items: [] };
        list.items.push((bullet ?? numbered)![1]!);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      flushList();
      paragraph.push(line.trim());
    }
    if (code) {
      out.push(`<pre>${this.escaper.escape(code.join("\n"))}</pre>`);
    }
    flushParagraph();
    flushList();
    return out.join("\n");
  }

  /**
   * One line's inline marks, on escaped text.
   */
  protected inline(text: string): string {
    const codes: string[] = [];
    let html = this.escaper
      .escape(text)
      .replace(/`([^`]+)`/g, (_match, inner: string) => {
        codes.push(inner);
        return `\uE000${codes.length - 1}\uE000`;
      });
    html = html
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_match, label: string, href: string) =>
          `<a href="${href}" style="color: #4f46e5;">${label}</a>`,
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return html.replace(
      /\uE000(\d+)\uE000/g,
      (_match, index: string) =>
        `<code style="background: #f3f4f6; padding: 0 4px; border-radius: 3px;">${codes[Number(index)]}</code>`,
    );
  }
}
