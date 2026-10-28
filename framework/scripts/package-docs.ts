import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";

import { AlephaError } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

/**
 * One page as it ships: where it came from, which package carries it, and the
 * front matter `alepha docs` reads without parsing the body.
 */
export interface PackagePage {
  slug: string;
  title: string;
  summary: string;
  package: string;
  section: string;
  source: string;
  body: string;
}

/**
 * Copies the framework's markdown pages into the packages that ship them, so
 * an installed app finds the docs of the version it installed at
 * `node_modules/<package>/docs/<slug>.md` (#E91, #Q2755).
 *
 * - `alepha` carries the guides, the reference, the CLI pages and its own
 *   package pages (`docs/3-packages/1-alepha`).
 * - Every other `docs/3-packages/<n>-<name>` goes to the package of that name
 *   (`2-@alepha-ui` is `@alepha/ui`). A name with no package fails the build.
 *
 * Every page is flat, named by the slug the site gives it (`/docs/<slug>`), so
 * a site link and a local page name the same thing. The slug rule is the one
 * `docs/scripts/gen-tree.ts` applies: drop each segment's order prefix, join
 * with dashes, lowercase, drop the first `@`. A link to `/docs/<slug>` (or
 * `https://alepha.dev/docs/<slug>`) becomes a relative path to that page, in
 * whichever package carries it: following a link never leaves the installed
 * version. Links to Lore and Bay pages go to the site, which is the only
 * place they exist.
 *
 * The output is generated, gitignored, and written by `yarn build` (release
 * and e2e-cli both build before they pack); `yarn clean` removes it.
 */
export class PackageDocsCommand {
  protected readonly log = $logger();

  /**
   * The framework root, one level above this file.
   */
  protected readonly root = join(import.meta.dirname, "..");

  /**
   * Same depth limit as the site's scan: a page deeper than this is not
   * published there either, so it is not shipped here.
   */
  protected readonly maxDepth = 3;

  public readonly docs = $command({
    name: "package:docs",
    description:
      "Copy the generated docs pages into node_modules-ready docs/ folders of each public package",
    handler: async ({ run }) => {
      const pages: PackagePage[] = [];

      await run("collect pages", async () => {
        pages.push(...(await this.collect()));
      });

      await run("write pages", async () => {
        await this.write(pages);
      });
    },
  });

  /**
   * Every page under `docs/`, with its slug, package and front matter.
   */
  public async collect(): Promise<PackagePage[]> {
    const docsDir = join(this.root, "docs");
    const pages: PackagePage[] = [];
    await this.scan(docsDir, [], pages, 0);
    return pages;
  }

  /**
   * Writes each package's `docs/`, replacing what a previous build left.
   */
  public async write(pages: PackagePage[]): Promise<void> {
    const bySlug = new Map(pages.map((page) => [page.slug, page]));
    const packages = new Set(pages.map((page) => page.package));

    for (const name of packages) {
      const dir = join(await this.packageDir(name), "docs");
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
    }

    let unresolved = 0;
    for (const page of pages) {
      const { body, missing } = this.rewriteLinks(page, bySlug);
      unresolved += missing.length;
      for (const slug of missing) {
        this.log.warn(`${page.slug}: link to unknown page /docs/${slug}`);
      }
      const file = join(
        await this.packageDir(page.package),
        "docs",
        `${page.slug}.md`,
      );
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `${this.frontMatter(page)}${body}`, "utf-8");
    }

    this.log.info(
      `Wrote ${pages.length} pages into ${packages.size} packages (${unresolved} unresolved links)`,
    );
  }

  protected async scan(
    dir: string,
    category: string[],
    pages: PackagePage[],
    level: number,
  ): Promise<void> {
    if (level > this.maxDepth) {
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "plans" || entry.name === "superpowers") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scan(path, [...category, entry.name], pages, level + 1);
      } else if (entry.name.endsWith(".md")) {
        pages.push(await this.page(path, category, entry.name));
      }
    }
  }

  protected async page(
    path: string,
    category: string[],
    filename: string,
  ): Promise<PackagePage> {
    const source = await readFile(path, "utf-8");
    const name = this.cleanName(filename).replace(/\.md$/, "");
    const parts = (category.length ? category : ["root"]).map((part) =>
      this.cleanName(part),
    );
    return {
      slug: this.slug([...parts, name].join("-")),
      title: this.title(source) ?? name,
      summary: this.summary(source),
      package: this.packageOf([...category, filename]),
      section: this.slug(parts[0] ?? "root"),
      source: relative(this.root, path),
      body: source,
    };
  }

  /**
   * `3-packages/<n>-<name>` names its package, as a folder or as a single
   * file (`9-create-alepha.md`); everything else is `alepha`.
   */
  protected packageOf(path: string[]): string {
    if (this.cleanName(path[0] ?? "") !== "packages" || !path[1]) {
      return "alepha";
    }
    const name = this.cleanName(path[1]).replace(/\.md$/, "");
    return name.startsWith("@alepha-")
      ? `@alepha/${name.slice("@alepha-".length)}`
      : name;
  }

  /**
   * The workspace directory of a package, which must exist and carry that
   * name: a docs folder naming no package is a mistake, not a skip.
   */
  protected async packageDir(name: string): Promise<string> {
    const dir = join(this.root, "packages", name);
    try {
      const pkg = JSON.parse(
        await readFile(join(dir, "package.json"), "utf-8"),
      );
      if (pkg.name !== name) {
        throw new AlephaError(`${dir} is ${pkg.name}, not ${name}`);
      }
    } catch (error) {
      if (error instanceof AlephaError) throw error;
      throw new AlephaError(
        `Docs name a package "${name}" that does not exist under packages/`,
      );
    }
    return dir;
  }

  /**
   * `/docs/<slug>`, `/docs/<slug>.md` and the same on `https://alepha.dev`,
   * with or without an anchor, become a relative path to the local page.
   * `/lore/...` and `/bay/...` become absolute site URLs.
   */
  public rewriteLinks(
    page: PackagePage,
    bySlug: Map<string, PackagePage>,
  ): { body: string; missing: string[] } {
    const missing: string[] = [];
    const from = posix.join("node_modules", page.package, "docs");
    const body = page.body
      .replace(
        /\]\((?:https:\/\/alepha\.dev)?\/docs\/([^)\s#]+?)(?:\.md)?(#[^)\s]*)?\)/g,
        (match, slug: string, anchor: string | undefined) => {
          const target = bySlug.get(slug);
          if (!target) {
            missing.push(slug);
            return match;
          }
          const to = posix.join(
            "node_modules",
            target.package,
            "docs",
            `${target.slug}.md`,
          );
          let rel = posix.relative(from, to);
          if (!rel.startsWith(".")) rel = `./${rel}`;
          return `](${rel}${anchor ?? ""})`;
        },
      )
      .replace(/\]\(\/(lore|bay)\//g, "](https://alepha.dev/$1/");
    return { body, missing };
  }

  /**
   * JSON-quoted values are valid YAML, whatever a summary contains.
   */
  protected frontMatter(page: PackagePage): string {
    const fields = {
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      package: page.package,
      section: page.section,
    };
    const lines = Object.entries(fields).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`,
    );
    return `---\n${lines.join("\n")}\n---\n\n`;
  }

  protected title(source: string): string | undefined {
    return source.match(/^#\s+(.+)$/m)?.[1]?.trim();
  }

  /**
   * The first sentence of the first prose paragraph: no heading, fence,
   * table, list, quote or HTML, and nothing under an `Installation` or
   * `Import` heading, which says the same thing on every package page. Links
   * keep their text, and the result is capped so the index stays one line per
   * page.
   */
  public summary(source: string): string {
    let fenced = false;
    let skipped = false;
    const paragraph: string[] = [];
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      const heading = line.match(/^#{2,}\s+(.+)$/);
      if (heading && !fenced) {
        if (paragraph.length) break;
        skipped = /^(installation|import)$/i.test(heading[1].trim());
        continue;
      }
      if (skipped) continue;
      if (line.startsWith("```")) {
        fenced = !fenced;
        if (paragraph.length) break;
        continue;
      }
      if (fenced) continue;
      if (!line) {
        if (paragraph.length) break;
        continue;
      }
      if (/^(#|\||[-*+] |\d+\. |<|>|!\[|:::|---)/.test(line)) {
        if (paragraph.length) break;
        continue;
      }
      paragraph.push(line);
    }
    const text = paragraph
      .join(" ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
    return sentence.length > 200
      ? `${sentence.slice(0, 197).trimEnd()}...`
      : sentence;
  }

  protected cleanName(name: string): string {
    return name.replace(/^\d+-/, "");
  }

  /**
   * The site's slug rule, from `docs/scripts/gen-tree.ts`.
   */
  protected slug(name: string): string {
    return name
      .toLowerCase()
      .replace(/^(\d+)-/, "")
      .replace(/[/\\]/g, "-")
      .replace(/\s+/g, "-")
      .replace("@", "");
  }
}
