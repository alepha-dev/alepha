/**
 * Derives the plain-text alternative of an HTML email body.
 *
 * **Why this exists rather than a dependency.** An HTML-only message scores
 * worse with every spam filter than the same message with a text part beside
 * it, so `EmailSendOptions.text` wants filling for every mail the framework
 * sends, not only the ones an app remembered to write twice. The obvious
 * library, `html-to-text`, is 188 KB, which is a poor trade on a runtime
 * where the whole point of `ReactDomServerProvider` is keeping 196 KB off
 * the cold-start path. react-email reached the same conclusion and grew its
 * own dependency-lighter `unstableToPlainText`.
 *
 * **What it is not.** This is not a general HTML-to-text converter. It
 * handles the markup transactional mail is actually made of: paragraphs,
 * headings, lists, links, line breaks and inline formatting. It does not lay
 * out tables, honour CSS, or reflow to a column width. A template that needs
 * better text than this declares its own `text` beside `body`, which always
 * wins over anything derived here.
 */
export class EmailTextRenderer {
  /**
   * Break markers, placed where a tag used to be and resolved to real
   * newlines only at the end.
   *
   * They exist because two adjacent breaks are not two newlines: `</li><li>`
   * must give one line, and `</p><div></div><p>` must give one blank line
   * rather than three. Counting each run at the end is what gets both right,
   * and that cannot be done once the markers are indistinguishable from the
   * newlines a body legitimately contains.
   */
  protected readonly LINE = "\u0000";
  protected readonly BLOCK = "\u0001";

  /**
   * Elements whose content is markup or styling rather than words, and must
   * not survive into the text part at all.
   */
  protected readonly dropped = /<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi;

  /**
   * Elements that end a line. A list item, a table row and a `br` break once.
   */
  protected readonly singleBreak = /<\/?(br|li|tr)\b[^>]*>/gi;

  /**
   * Elements that end a block, which is what puts a blank line between two
   * paragraphs.
   */
  protected readonly doubleBreak =
    /<\/?(p|div|h[1-6]|ul|ol|table|section|article|header|footer|blockquote|pre)\b[^>]*>/gi;

  /**
   * The entities that actually turn up in mail. Anything else is left as
   * written: a stray `&pound;` reads better than a replacement character.
   */
  protected readonly entities: Array<[RegExp, string]> = [
    [/&nbsp;/gi, " "],
    [/&lt;/gi, "<"],
    [/&gt;/gi, ">"],
    [/&quot;/gi, '"'],
    [/&#0*39;|&apos;/gi, "'"],
    [/&mdash;|&ndash;/gi, "-"],
    [/&hellip;/gi, "..."],
    // Ampersand last, so `&amp;lt;` decodes to `&lt;` and not to `<`.
    [/&amp;/gi, "&"],
  ];

  /**
   * Convert an HTML body to its plain-text equivalent.
   */
  public fromHtml(html: string): string {
    let text = html.replace(this.dropped, "");

    text = this.expandLinks(text);
    // Source formatting is not content. A pretty-printed paragraph carries
    // newlines that mean nothing, and they have to go before the real breaks
    // arrive, or the two become impossible to tell apart.
    text = text.replace(/\s+/g, " ");
    text = text.replace(this.doubleBreak, this.BLOCK);
    text = text.replace(this.singleBreak, this.LINE);
    text = text.replace(/<[^>]+>/g, "");
    text = this.decode(text);

    return this.tidy(text);
  }

  /**
   * Rewrite `<a href="URL">TEXT</a>` as `TEXT (URL)`, so a reader of the text
   * part can still reach the link. When the label already is the URL, adding
   * it again would only be noise, and a `mailto:` reads fine on its own.
   */
  protected expandLinks(html: string): string {
    return html.replace(
      /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, double, single, bare, label) => {
        const href = (double ?? single ?? bare ?? "").trim();
        const text = String(label)
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!href || href.startsWith("mailto:") || this.decode(text) === href) {
          return text;
        }
        return `${text} (${href})`;
      },
    );
  }

  protected decode(text: string): string {
    let out = text;
    for (const [pattern, replacement] of this.entities) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  /**
   * Resolve each run of break markers to a single newline, or to a blank
   * line when any marker in the run came from a block element.
   */
  protected tidy(text: string): string {
    const runs = new RegExp(
      `[${this.LINE}${this.BLOCK} ]*[${this.LINE}${this.BLOCK}][${this.LINE}${this.BLOCK} ]*`,
      "g",
    );
    return text
      .replace(runs, (matched) =>
        matched.includes(this.BLOCK) ? "\n\n" : "\n",
      )
      .replace(/ {2,}/g, " ")
      .trim();
  }
}
