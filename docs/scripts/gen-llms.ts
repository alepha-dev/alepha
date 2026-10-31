import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { AlephaError } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { DocsMarkdown } from "./DocsMarkdown.ts";
import type { DocNode, DocProduct } from "./interfaces.ts";
import { DocsRoots } from "./roots.ts";

interface DocItem {
  product: DocProduct;
  slug: string;
  name: string;
  description: string;
  path: string;
}

/**
 * A doc page as the agent files list it.
 */
interface Page {
  title: string;
  description: string;
  url: string;
  markdown: string;
}

/**
 * What heads each product's own `llms.txt`, and describes it from the
 * framework's. The framework's preamble lives in `public/llms-index.md`, long
 * enough to deserve a file and audited by `check:docs`; Bay and Lore need a
 * title and a sentence. Same sentences as their home pages in `AppRouter`.
 */
const PRODUCTS: Record<
  Exclude<DocProduct, "">,
  { title: string; summary: string }
> = {
  bay: {
    title: "Bay",
    summary:
      "A self-hosted application server for Alepha apps, with TLS, rollback and process isolation handled for you.",
  },
  lore: {
    title: "Lore",
    summary:
      "An open-source project management app built on Alepha. Quests, folios, feedback and crash telemetry, readable and writable over MCP.",
  },
};

/**
 * The framework sections too long to list page by page in `/llms.txt`. Each
 * gets an index of its own, linked from there, with the note the link
 * carries. A section not named here is listed in full.
 */
const INDEXED: Record<string, (pages: number) => string> = {
  "reference/primitives": (n) =>
    `Index of the ${n} primitives (\`$action\`, \`$entity\`, \`$page\`, \`$job\`...), one page each with its import path and API.`,
  "reference/react-hooks": (n) =>
    `Index of the ${n} React hooks, one page each with its import path and API.`,
  "reference/providers": (n) =>
    `Index of the ${n} providers: the services behind the primitives, the ones an app injects, and the ones it swaps.`,
  packages: (n) =>
    `Index of the ${n} package pages: every module of \`alepha\` (\`alepha/server\`, \`alepha/orm\`...) and every \`@alepha/*\` package, with its install line and overview.`,
};

/**
 * Display names a capital letter gets wrong.
 */
const TITLES: Record<string, string> = {
  ai: "AI",
  cli: "CLI",
  "react-hooks": "React hooks",
};

/**
 * What `/llms.txt` should stay under. Past it, an agent that reads the index
 * first pays for every page it will not fetch. A warning, not a failure: a
 * new guide must not break a deploy, but someone should look.
 */
const INDEX_BUDGET = 32 * 1024;

/**
 * What one `llms-full.txt` should stay under: the whole file has to fit in a
 * context window beside the work it is for.
 */
const BUNDLE_BUDGET = 400 * 1024;

/**
 * Generates the files agents read, following llmstxt.org.
 *
 * - `/llms.txt`: `public/llms-index.md`, then every guide and CLI page with
 *   a one-line note, then links to the indexes below, then the products.
 * - `/docs/reference/<kind>/llms.txt`, `/docs/packages/llms.txt`: one index
 *   per section too long to list in `/llms.txt` (319 reference pages and
 *   115 package pages would triple it).
 * - `/docs/<section>/<folder>/llms-full.txt`: every page of one guide or CLI
 *   folder in a single file, for an agent that wants a whole topic in one
 *   fetch.
 * - `/bay/llms.txt`, `/lore/llms.txt`, each with its `llms-full.txt`: the
 *   products, each at the root of its own URL space.
 * - `/docs/<slug>.md`, `/bay/docs/<slug>.md`...: every page as markdown, its
 *   doc links absolute and pointed at the `.md` copies, build markers taken
 *   out of its fences. The HTML page links it as `rel="alternate"`.
 *
 * Every URL written is checked against the files written, and the run fails
 * on one that leads nowhere.
 *
 * ⚠️ There is no site-wide `llms-full.txt`, deliberately. It concatenated
 * every page into ~1.2 MB (~290k tokens): larger than most context windows,
 * and a fetch tool that summarises what it reads kept almost none of it. The
 * per-folder files are the same idea cut to a size an agent can use.
 */
export class LlmsCommand {
  protected log = $logger();

  llms = $command({
    name: "gen:llms",
    description:
      "Generate the llms.txt indexes, the per-folder llms-full.txt files, and the markdown pages they link to",
    handler: async ({ run }) => {
      const docsDir = join(import.meta.dirname, "../.gen");
      const publicDir = join(import.meta.dirname, "../public");
      const outputDir = join(import.meta.dirname, "../dist/public");

      await run("check generated docs", async () => {
        try {
          await fs.access(docsDir);
        } catch {
          throw new AlephaError(`Docs directory not found: ${docsDir}`);
        }
      });

      const indexModule = await import("../.gen/index.ts");
      const trees = indexModule.trees as Record<DocProduct, DocNode[]>;
      const docs = indexModule.docs as DocItem[];
      const products = (
        Object.keys(PRODUCTS) as Array<keyof typeof PRODUCTS>
      ).filter((product) => (trees[product] ?? []).length > 0);

      const pages = new Map<string, Page>();
      const written = new Map<string, string>();
      const write = async (path: string, content: string) => {
        written.set(path, content);
        await this.write(join(outputDir, path), content);
      };

      await run("write markdown pages", async () => {
        for (const doc of docs) {
          // The product goes in the PATH, mirroring the URL these files
          // stand in for: `/docs/x.md`, `/bay/docs/x.md`. A slug is unique
          // only within a product, so a flat directory would keep whichever
          // of the three was written last (quest #1603).
          const source = await fs.readFile(
            join(DocsRoots.repo, doc.path),
            "utf-8",
          );
          const markdown = DocsMarkdown.forAgents(source);
          const url = DocsMarkdown.url(doc);
          pages.set(url, {
            title: DocsMarkdown.title(source) ?? doc.name,
            description: doc.description,
            url,
            markdown,
          });
          await write(this.pathOf(url), markdown);
        }
      });

      await run("write llms.txt", async () => {
        const preamble = await fs.readFile(
          join(publicDir, "llms-index.md"),
          "utf-8",
        );

        const sections: string[] = [];
        const indexes: string[] = [];

        for (const node of trees[""] ?? []) {
          if (!node.children || node.asset) {
            continue;
          }
          if (INDEXED[node.slug]) {
            const file = `/docs/${node.slug}/llms.txt`;
            await write(file, this.renderIndex(node, [node.slug], pages));
            indexes.push(this.link(file, node, node.slug, pages));
            continue;
          }
          const direct = this.leaves(node, pages, false);
          if (direct.length > 0) {
            sections.push(this.section(this.titleOf(node), direct));
          }
          for (const child of node.children) {
            if (!child.children) {
              continue;
            }
            const key = `${node.slug}/${child.slug}`;
            if (INDEXED[key]) {
              const file = `/docs/${key}/llms.txt`;
              await write(file, this.renderIndex(child, [key], pages));
              indexes.push(this.link(file, child, key, pages));
              continue;
            }
            const title = `${this.titleOf(node)}: ${this.titleOf(child)}`;
            const all = this.pagesOf(child, pages);
            const bundle = `/docs/${key}/llms-full.txt`;
            await write(bundle, this.renderBundle(title, all));
            sections.push(
              this.section(title, [
                this.bundleEntry(bundle, title, all),
                ...all.map((page) => this.entry(page)),
              ]),
            );
          }
        }

        await write(
          "/llms.txt",
          [
            preamble.trimEnd(),
            "",
            ...sections,
            this.section("API reference", indexes),
            this.section(
              "Optional",
              products.map(
                (product) =>
                  `- [${PRODUCTS[product].title}](${DocsMarkdown.SITE}/${product}/llms.txt): ${PRODUCTS[product].summary}`,
              ),
            ),
          ]
            .join("\n")
            .trimEnd()
            .concat("\n"),
        );

        for (const product of products) {
          const { title, summary } = PRODUCTS[product];
          const all = (trees[product] ?? []).flatMap((node) =>
            this.pagesOf(node, pages),
          );
          const bundle = `/${product}/llms-full.txt`;
          if (all.length > 1) {
            await write(
              bundle,
              this.renderBundle(title, all, {
                scope: `the ${title} documentation`,
                index: `${DocsMarkdown.SITE}/${product}/llms.txt`,
              }),
            );
          }
          const body = (trees[product] ?? [])
            .filter((node) => !node.asset)
            .map((node, index) => {
              const entries = this.pagesOf(node, pages).map((page) =>
                this.entry(page),
              );
              if (index === 0 && all.length > 1) {
                entries.unshift(this.bundleEntry(bundle, title, all));
              }
              return this.section(this.titleOf(node), entries);
            });
          await write(
            `/${product}/llms.txt`,
            [
              `# ${title}`,
              "",
              `> ${summary}`,
              "",
              ...body,
              this.section("Optional", [
                `- [Alepha](${DocsMarkdown.SITE}/llms.txt): The TypeScript framework ${title} is built on, and its documentation index.`,
              ]),
            ]
              .join("\n")
              .trimEnd()
              .concat("\n"),
          );
        }
      });

      await run("check every link resolves", async () => {
        const dangling = this.dangling(written);
        // Pinned, a Lore page from `main` may name a page that ships with the
        // next release. That link is dead until then, which is no reason to
        // hold back every other page. The working tree, which the `check` job
        // builds, has no such excuse.
        if (DocsRoots.pinned()) {
          for (const it of dangling) {
            this.log.warn(it);
          }
          return;
        }
        for (const it of dangling) {
          this.log.error(it);
        }
        if (dangling.length > 0) {
          throw new AlephaError(
            `${dangling.length} link(s) in the agent files lead nowhere`,
          );
        }
      });

      await run("report sizes", async () => {
        for (const [path, content] of written) {
          if (path.endsWith(".md")) {
            continue;
          }
          const bytes = Buffer.byteLength(content);
          const budget = path.endsWith("llms-full.txt")
            ? BUNDLE_BUDGET
            : path === "/llms.txt"
              ? INDEX_BUDGET
              : undefined;
          const line = `${path}: ${Math.round(bytes / 1024)} KB, ${this.tokens(content)}`;
          if (budget && bytes > budget) {
            this.log.warn(
              `${line}, over its ${Math.round(budget / 1024)} KB budget`,
            );
          } else {
            this.log.info(line);
          }
        }
        const mirrors = [...written.keys()].filter((it) => it.endsWith(".md"));
        this.log.info(`${mirrors.length} markdown pages`);
      });
    },
  });

  protected async write(file: string, content: string): Promise<void> {
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf-8");
    this.log.trace(`Wrote ${content.length} chars to ${file}`);
  }

  /**
   * The index of one section too long for `/llms.txt`: a `##` per folder,
   * the pages straight under it gathered last.
   */
  protected renderIndex(
    node: DocNode,
    keys: string[],
    pages: Map<string, Page>,
  ): string {
    const title = this.titleOf(node);
    const note = INDEXED[keys[0]](this.pagesOf(node, pages).length);
    const groups: string[] = [];
    const loose: string[] = [];
    for (const child of node.children ?? []) {
      if (child.children) {
        groups.push(
          this.section(
            child.name,
            this.pagesOf(child, pages).map((page) => this.entry(page)),
          ),
        );
      } else {
        loose.push(...this.leaves({ ...node, children: [child] }, pages));
      }
    }
    const body =
      groups.length === 0
        ? [this.section(title, loose)]
        : [
            ...groups,
            ...(loose.length > 0
              ? [this.section(`Other ${title.toLowerCase()}`, loose)]
              : []),
          ];
    return [
      `# Alepha ${title.toLowerCase()}`,
      "",
      `> ${note}`,
      "",
      ...body,
      this.section("Optional", [
        `- [Alepha](${DocsMarkdown.SITE}/llms.txt): The framework's documentation index: guides, CLI, and the other reference indexes.`,
      ]),
    ]
      .join("\n")
      .trimEnd()
      .concat("\n");
  }

  /**
   * One folder's pages in one file, each opened by the URL it came from so a
   * quote can be traced back to its page.
   */
  protected renderBundle(
    title: string,
    pages: Page[],
    {
      scope = "this section of the Alepha documentation",
      index = `${DocsMarkdown.SITE}/llms.txt`,
    } = {},
  ): string {
    return [
      `# ${title}`,
      "",
      `> Every page of ${scope}, in reading order: ${pages.length} pages. The index of all of them is ${index}.`,
      "",
      ...pages.flatMap((page) => [
        "---",
        "",
        `Source: ${page.url}`,
        "",
        page.markdown.trim(),
        "",
      ]),
    ].join("\n");
  }

  protected section(title: string, entries: string[]): string {
    return entries.length > 0 ? `## ${title}\n\n${entries.join("\n")}\n` : "";
  }

  protected entry(page: Page): string {
    return `- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`;
  }

  protected bundleEntry(path: string, title: string, pages: Page[]): string {
    const size = pages.reduce((sum, page) => sum + page.markdown.length, 0);
    return `- [${title}, every page in one file](${DocsMarkdown.SITE}${path}): ${pages.length} pages, ${this.tokens(size)}.`;
  }

  protected link(
    path: string,
    node: DocNode,
    key: string,
    pages: Map<string, Page>,
  ): string {
    const note = INDEXED[key](this.pagesOf(node, pages).length);
    return `- [${this.titleOf(node)}](${DocsMarkdown.SITE}${path}): ${note}`;
  }

  /**
   * The pages of a node, depth first, in sidebar order.
   */
  protected pagesOf(node: DocNode, pages: Map<string, Page>): Page[] {
    if (node.asset) {
      return [];
    }
    if (!node.children) {
      const page = node.href
        ? pages.get(`${DocsMarkdown.SITE}${node.href}.md`)
        : undefined;
      return page ? [page] : [];
    }
    return node.children.flatMap((child) => this.pagesOf(child, pages));
  }

  /**
   * The list entries of a node's pages; with `deep` false, only the pages
   * straight under it.
   */
  protected leaves(
    node: DocNode,
    pages: Map<string, Page>,
    deep = true,
  ): string[] {
    return (node.children ?? [])
      .filter((child) => deep || !child.children)
      .flatMap((child) => this.pagesOf(child, pages))
      .map((page) => this.entry(page));
  }

  protected titleOf(node: DocNode): string {
    const name = node.name;
    if (TITLES[name]) {
      return TITLES[name];
    }
    if (name.startsWith("@")) {
      return name;
    }
    const words = name.replace(/-/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /**
   * Where a URL of this site lands under `dist/public`.
   */
  protected pathOf(url: string): string {
    return url.slice(DocsMarkdown.SITE.length);
  }

  /**
   * Every link in the files written that points at a file of this site and
   * is not one of them.
   */
  protected dangling(written: Map<string, string>): string[] {
    const problems: string[] = [];
    const target = /\]\((https:\/\/alepha\.dev\/[^)\s#]+\.(?:md|txt))/g;
    for (const [path, content] of written) {
      for (const match of content.matchAll(target)) {
        if (!written.has(this.pathOf(match[1]))) {
          problems.push(`${path} links ${match[1]}, which is not generated`);
        }
      }
    }
    return problems;
  }

  /**
   * A rough count, at four characters a token, which is what a reader needs
   * to decide whether a file fits.
   */
  protected tokens(content: string | number): string {
    const chars = typeof content === "number" ? content : content.length;
    const thousands = Math.round(chars / 4 / 1000);
    return thousands < 1 ? "under 1k tokens" : `~${thousands}k tokens`;
  }
}
