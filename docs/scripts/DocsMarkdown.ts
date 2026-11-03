import type { DocProduct } from "./interfaces.ts";

/**
 * A link to a doc page, as written in markdown.
 */
export interface DocLink {
  product: DocProduct;
  slug: string;
  anchor?: string;
  /**
   * 1-based.
   */
  line: number;
}

/**
 * The rules every reader of a doc source has to agree on, in one place.
 *
 * `gen-tree` names a page and its heading anchors, `check:docs` refuses a
 * link that reaches neither, and `gen-llms` writes the copies agents read.
 * Each used to carry its own copy of a rule, and a copy drifts: the checker
 * knew only the reference pages, so a guide renamed under a link went
 * unnoticed until a reader followed it.
 *
 * Pure functions over text, so all three, and the tests, call them without a
 * container.
 */
export class DocsMarkdown {
  /**
   * The address of the site being built: the `latest` deploy names its own
   * (#Q3028), so its agent files link to itself.
   */
  public static readonly SITE = process.env.PUBLIC_URL ?? "https://alepha.dev";

  /**
   * Point every absolute link of an agent file at the site being built, so a
   * reader of latest.alepha.dev stays on it.
   */
  public static forSite(text: string, site = DocsMarkdown.SITE): string {
    return text.replace(DocsMarkdown.RELEASE_SITE, site);
  }

  /**
   * A doc link: `/docs/x`, `/bay/docs/x` or `/lore/docs/x`, site-relative or
   * absolute, with an optional `.md`, anchor and title. Group 1 is the
   * product, 2 the slug, 3 the anchor, 4 the title.
   */
  protected static readonly DOC_LINK =
    /\]\((?:https:\/\/alepha\.dev)?\/(?:(bay|lore)\/)?docs\/([^)\s#?]+?)(?:\.md)?(?:#([^)\s]*))?(\s+"[^"]*")?\)/g;

  /**
   * The site's address as the pages spell it.
   */
  protected static readonly RELEASE_SITE =
    /https:\/\/alepha\.dev(?![\w-]|\.\w)/g;

  protected static readonly FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;

  protected static readonly ATX_HEADING =
    /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

  /**
   * Sections whose first paragraph says how to get a page, not what it is
   * about: the generated reference and package pages open on them.
   */
  protected static readonly NOT_A_SUMMARY =
    /^(import|installation|install|table of contents|contents|prerequisites)$/i;

  /**
   * A page's slug from where it sits under its `docs/` root: order prefixes
   * dropped, the path joined with dashes, lowercased, the first `@` gone.
   * `1-guides/4-server` and `1-building-an-api` give
   * `guides-server-building-an-api`. A file at the root has the category
   * `root`, as it always had.
   */
  public static slug(categoryPath: string, filename: string): string {
    const parts = (categoryPath || "root")
      .split("/")
      .map((part) => DocsMarkdown.unorder(part));
    parts.push(DocsMarkdown.unorder(filename.replace(/\.md$/, "")));
    return DocsMarkdown.slugify(parts.join("-"));
  }

  public static slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/^(\d+)-/, "")
      .replace(/[/\\]/g, "-")
      .replace(/\s+/g, "-")
      .replace("@", "");
  }

  public static unorder(name: string): string {
    return name.replace(/^\d+-/, "");
  }

  /**
   * GitHub's rule, so an anchor written against the markdown on GitHub or in
   * an installed package (`#folds-sum-min-max-and-last`) reaches the same
   * heading on the site: lowercase, drop every character that is not a
   * letter, digit, mark, `_`, `-` or space, spaces become dashes. Unlike
   * GitHub, the ends are trimmed, so a heading opening on an emoji gets no
   * leading dash.
   *
   * `text` is the heading's raw inline markdown, as `marked` hands it over.
   */
  public static headingId(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]|[\uFE00-\uFE0F\u200D]/gu, "")
      .trim()
      .replace(/ /g, "-");
  }

  /**
   * Every heading id a page renders, de-duplicated GitHub-style: the second
   * "## Secrets" is `#secrets-1`.
   */
  public static headingIds(markdown: string): Set<string> {
    const seen = new Map<string, number>();
    const ids = new Set<string>();
    for (const { text } of DocsMarkdown.headings(markdown)) {
      const base = DocsMarkdown.headingId(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      ids.add(count === 0 ? base : `${base}-${count}`);
    }
    return ids;
  }

  /**
   * The page's `# Title`, as plain text.
   */
  public static title(markdown: string): string | undefined {
    for (const heading of DocsMarkdown.headings(markdown)) {
      if (heading.depth === 1) {
        return DocsMarkdown.plain(heading.text);
      }
    }
    return undefined;
  }

  /**
   * One or two sentences saying what a page is about: the first paragraph
   * of prose, skipping the "Import" and "Installation" sections a generated
   * page opens on. It becomes the page's `<meta name="description">` and its
   * note in `llms.txt`.
   */
  public static description(markdown: string, max = 200): string {
    let skipping = false;
    let paragraph: string[] = [];

    for (const { line, fenced, heading } of DocsMarkdown.lines(markdown)) {
      if (heading) {
        if (paragraph.length > 0) {
          break;
        }
        skipping =
          heading.depth > 1 &&
          DocsMarkdown.NOT_A_SUMMARY.test(DocsMarkdown.plain(heading.text));
        continue;
      }
      if (skipping) {
        continue;
      }
      const prose =
        !fenced &&
        line.trim() !== "" &&
        !/^\s*([|>!<:]|[-*+] |\d+\. |```|~~~|---|\[[^\]]+\]:)/.test(line);
      if (prose) {
        paragraph.push(line.trim());
      } else if (paragraph.length > 0) {
        break;
      }
    }

    return DocsMarkdown.summarize(DocsMarkdown.plain(paragraph.join(" ")), max);
  }

  /**
   * Inline markdown as the text it reads as.
   */
  public static plain(text: string): string {
    // Code spans first, and put back last: `_raw` and `_<tier>` are code,
    // not emphasis and a tag.
    const code: string[] = [];
    return text
      .replace(
        /`([^`]+)`/g,
        (_, span: string) => `\u0000${code.push(span) - 1}\u0000`,
      )
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?=[^\w*]|$)/g, "$1$2")
      .replace(/(^|[^\w])_([^_\s][^_]*)_(?=[^\w]|$)/g, "$1$2")
      .replace(/\u0000(\d+)\u0000/g, (_, index: string) => code[Number(index)])
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Every link to a doc page, with the line it is on. Links inside a code
   * fence are code, and skipped.
   */
  public static docLinks(markdown: string): DocLink[] {
    const links: DocLink[] = [];
    for (const { line, fenced, number } of DocsMarkdown.lines(markdown)) {
      if (fenced) {
        continue;
      }
      for (const match of line.matchAll(DocsMarkdown.DOC_LINK)) {
        links.push({
          product: (match[1] ?? "") as DocProduct,
          slug: match[2],
          anchor: match[3] || undefined,
          line: number,
        });
      }
    }
    return links;
  }

  /**
   * Links to a heading of the same page: `[text](#anchor)`, outside fences.
   */
  public static anchorLinks(
    markdown: string,
  ): Array<{ anchor: string; line: number }> {
    const links: Array<{ anchor: string; line: number }> = [];
    for (const { line, fenced, number } of DocsMarkdown.lines(markdown)) {
      if (fenced) {
        continue;
      }
      for (const match of line.matchAll(/\]\(#([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        links.push({ anchor: match[1], line: number });
      }
    }
    return links;
  }

  /**
   * The markdown an agent reads at `/docs/<slug>.md`: the source, with every
   * doc link made absolute and pointed at the `.md` copy (a site-relative
   * `/docs/x` means nothing to a fetch tool holding only this file), and the
   * fence markers that are build instructions (`check`) taken out of the
   * info string.
   */
  public static forAgents(markdown: string): string {
    const out: string[] = [];
    let fence: string | undefined;

    for (const line of markdown.split("\n")) {
      const open = DocsMarkdown.FENCE.exec(line);
      if (fence) {
        if (open && DocsMarkdown.closes(fence, open)) {
          fence = undefined;
        }
        out.push(line);
        continue;
      }
      if (open) {
        fence = open[2];
        const info = open[3]
          .trim()
          .split(/\s+/)
          .filter((word) => word !== "check")
          .join(" ");
        out.push(`${open[1]}${open[2]}${info}`);
        continue;
      }
      out.push(
        line.replace(
          DocsMarkdown.DOC_LINK,
          (
            _all,
            product: string | undefined,
            slug: string,
            anchor: string | undefined,
            title: string | undefined,
          ) =>
            `](${DocsMarkdown.url({ product: (product ?? "") as DocProduct, slug })}${anchor ? `#${anchor}` : ""}${title ?? ""})`,
        ),
      );
    }
    return out.join("\n");
  }

  /**
   * Where the markdown copy of a page is served.
   */
  public static url(doc: { product: DocProduct; slug: string }): string {
    return `${DocsMarkdown.SITE}${doc.product ? `/${doc.product}` : ""}/docs/${doc.slug}.md`;
  }

  /**
   * Every heading outside a code fence.
   */
  public static headings(
    markdown: string,
  ): Array<{ depth: number; text: string }> {
    const headings: Array<{ depth: number; text: string }> = [];
    for (const { heading } of DocsMarkdown.lines(markdown)) {
      if (heading) {
        headings.push(heading);
      }
    }
    return headings;
  }

  protected static *lines(markdown: string): Generator<{
    line: string;
    number: number;
    fenced: boolean;
    heading?: { depth: number; text: string };
  }> {
    let fence: string | undefined;
    for (const [index, line] of markdown.split("\n").entries()) {
      const open = DocsMarkdown.FENCE.exec(line);
      if (fence) {
        if (open && DocsMarkdown.closes(fence, open)) {
          fence = undefined;
        }
        yield { line, number: index + 1, fenced: true };
        continue;
      }
      if (open) {
        fence = open[2];
        yield { line, number: index + 1, fenced: true };
        continue;
      }
      const heading = DocsMarkdown.ATX_HEADING.exec(line);
      yield {
        line,
        number: index + 1,
        fenced: false,
        heading: heading
          ? { depth: heading[1].length, text: heading[2].trim() }
          : undefined,
      };
    }
  }

  /**
   * CommonMark: a fence closes on the same character, at least as long,
   * with nothing after it.
   */
  protected static closes(fence: string, line: RegExpExecArray): boolean {
    return (
      line[2][0] === fence[0] &&
      line[2].length >= fence.length &&
      line[3].trim() === ""
    );
  }

  /**
   * The first sentence, and the next while the first is short; cut at a
   * word if a sentence alone runs past `max`.
   */
  protected static summarize(text: string, max: number): string {
    if (!text) {
      return "";
    }
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9$@`"(])/);
    // A sentence ending on a colon introduces what follows it on the page,
    // a list or a code block, and reads as a fragment on its own.
    let summary = sentences[0].replace(/:$/, ".");
    for (const next of sentences.slice(1)) {
      if (
        summary.length >= 80 ||
        summary.length + 1 + next.length > max ||
        next.endsWith(":")
      ) {
        break;
      }
      summary = `${summary} ${next}`;
    }
    if (summary.length > max) {
      const cut = summary.slice(0, max - 3);
      summary = `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}...`;
    }
    return summary;
  }
}
