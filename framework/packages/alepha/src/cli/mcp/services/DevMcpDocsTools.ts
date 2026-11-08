import { $inject, z } from "alepha";
import { DocsLibrary } from "alepha/cli";
import { $tool } from "alepha/mcp";

import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * `alepha mcp`: the Alepha docs of the version the project installed, the
 * ones `alepha docs` prints, read from `node_modules`. They need no app
 * running.
 */
export class DevMcpDocsTools {
  protected readonly session = $inject(DevMcpSession);
  protected readonly library = $inject(DocsLibrary);

  /**
   * How many matching lines `docs_search` returns before it counts the rest,
   * as `alepha docs --grep` does.
   */
  protected readonly grepLimit = 200;

  public readonly docsSearch = $tool({
    name: "docs_search",
    description:
      "Search the Alepha docs of the version this project installed: every line containing the text, as `slug:line: text`. Read a page with docs_read. Works with no app running.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({ text: z.text().describe("The text to find") }),
    },
    handler: async ({ params }) => {
      const pages = await this.library.pages(this.session.root);
      if (!pages.length) return this.noDocs();
      const matches = await this.library.grep(pages, params.text);
      if (!matches.length)
        return `No installed page contains "${params.text}".`;
      const lines = matches
        .slice(0, this.grepLimit)
        .map((match) => `${match.page.slug}:${match.line}: ${match.text}`);
      if (matches.length > this.grepLimit) {
        lines.push(
          "",
          `... ${matches.length - this.grepLimit} more lines. Narrow the search, or read a page with docs_read.`,
        );
      }
      return lines.join("\n");
    },
  });

  public readonly docsRead = $tool({
    name: "docs_read",
    description:
      "One page of the installed Alepha docs, word for word: by slug (`guides-server-building-an-api`), or by a primitive, hook or provider name (`$entity`). Without a page, the index of every page. Works with no app running.",
    annotations: { readOnlyHint: true },
    schema: {
      params: z.object({
        page: z
          .text()
          .describe("A slug or a name; leave it out for the index")
          .optional(),
      }),
    },
    handler: async ({ params }) => {
      const pages = await this.library.pages(this.session.root);
      if (!pages.length) return this.noDocs();
      if (!params.page) {
        return pages
          .map(
            (page) =>
              `- ${page.slug} (${page.title})${page.summary ? `: ${page.summary}` : ""}`,
          )
          .join("\n");
      }

      const found = this.library.find(pages, params.page);
      if (found.length === 1) {
        return (await this.library.read(found[0])).trimEnd();
      }
      const candidates = found.length
        ? found
        : this.library.suggest(pages, params.page);
      return [
        found.length
          ? `"${params.page}" matches ${found.length} pages:`
          : `No page matches "${params.page}". Closest:`,
        "",
        ...candidates.map(
          (page) => `- ${page.slug} (${page.title}): ${page.summary}`,
        ),
      ].join("\n");
    },
  });

  protected noDocs(): string {
    return `No Alepha docs found from ${this.session.root}: the project installs no alepha at a version that ships its docs.`;
  }
}
