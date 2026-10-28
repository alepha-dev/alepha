import { $inject, z } from "alepha";
import { $command, CommandError, ConsoleOutputProvider } from "alepha/command";

import { type DocsPage, DocsLibrary } from "../services/DocsLibrary.ts";

export class DocsCommand {
  protected readonly library = $inject(DocsLibrary);
  protected readonly output = $inject(ConsoleOutputProvider);

  /**
   * How many `--grep` lines are printed before the rest is counted instead.
   * An agent asking a broad question gets a page of answers and a nudge to
   * narrow it, not the corpus.
   */
  protected readonly grepLimit = 200;

  /**
   * Print the Alepha docs of the version this project installed, from
   * `node_modules`, word for word.
   *
   * ```bash
   * npx alepha docs                 # the index: one line per installed page
   * npx alepha docs guides-server-building-an-api   # one page, by slug
   * npx alepha docs '$entity'       # a primitive, hook or provider by name
   * npx alepha docs --grep paginate # every line mentioning "paginate"
   * ```
   *
   * The pages ship inside each package, at `node_modules/<package>/docs/`,
   * so they always describe the installed version and need no network. Only
   * installed packages appear: a project without `@alepha/ui` sees none of
   * its pages. The output is plain markdown with no colour, whatever the
   * terminal, because the reader is usually an agent piping it.
   *
   * The bare command prints the index and never the whole corpus, which is
   * about 2 MB. An unknown name prints the closest pages and exits with 1.
   */
  public readonly docs = $command({
    name: "docs",
    description:
      "Print the docs of the installed Alepha version: the index, a page, or --grep results",
    args: z
      .text({
        title: "page",
        trim: true,
      })
      .optional(),
    flags: z.object({
      grep: z
        .text({ trim: true })
        .describe(
          "Print every line of every installed page containing this text",
        )
        .optional(),
    }),
    handler: async ({ root, args, flags }) => {
      const pages = await this.library.pages(root);
      if (!pages.length) {
        throw new CommandError(
          `No Alepha docs found from ${root}: run it from a project that installs alepha, at a version that ships its docs.`,
        );
      }

      if (flags.grep) {
        await this.printGrep(pages, flags.grep);
        return;
      }

      if (args) {
        await this.printPage(pages, args);
        return;
      }

      this.printIndex(pages);
    },
  });

  protected printIndex(pages: DocsPage[]): void {
    const lines: string[] = [
      "# Alepha docs",
      "",
      "The pages of the Alepha packages installed in this project, for their installed version.",
      "",
      "- `npx alepha docs <slug>` prints one page; a primitive, hook or provider name works too (`npx alepha docs '$entity'`).",
      "- `npx alepha docs --grep <text>` prints every line containing the text.",
      "- The files are `node_modules/<package>/docs/<slug>.md`.",
    ];

    let current = "";
    for (const page of pages) {
      const heading = `${page.package}@${page.version} - ${page.section}`;
      if (heading !== current) {
        current = heading;
        lines.push("", `## ${heading}`, "");
      }
      const summary = page.summary ? `: ${page.summary}` : "";
      lines.push(`- ${page.slug} (${page.title})${summary}`);
    }
    this.output.print(lines.join("\n"));
  }

  protected async printPage(pages: DocsPage[], query: string): Promise<void> {
    const found = this.library.find(pages, query);
    if (found.length === 1) {
      this.output.print((await this.library.read(found[0])).trimEnd());
      return;
    }

    const candidates = found.length
      ? found
      : this.library.suggest(pages, query);
    this.output.print(
      [
        found.length
          ? `"${query}" matches ${found.length} pages:`
          : `No page matches "${query}". Closest:`,
        "",
        ...candidates.map(
          (page) => `- ${page.slug} (${page.title}): ${page.summary}`,
        ),
        "",
        "Print one with `npx alepha docs <slug>`.",
      ].join("\n"),
    );
    throw new CommandError(
      found.length
        ? `"${query}" is ambiguous`
        : `No docs page matches "${query}"`,
    );
  }

  protected async printGrep(pages: DocsPage[], text: string): Promise<void> {
    const matches = await this.library.grep(pages, text);
    if (!matches.length) {
      this.output.print(`No installed page contains "${text}".`);
      return;
    }
    const lines = matches
      .slice(0, this.grepLimit)
      .map((match) => `${match.page.slug}:${match.line}: ${match.text}`);
    if (matches.length > this.grepLimit) {
      lines.push(
        "",
        `... ${matches.length - this.grepLimit} more lines. Narrow the search, or print a page with \`npx alepha docs <slug>\`.`,
      );
    }
    this.output.print(lines.join("\n"));
  }
}
