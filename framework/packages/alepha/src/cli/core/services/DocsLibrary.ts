import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * One installed docs page, read from its front matter.
 */
export interface DocsPage {
  slug: string;
  title: string;
  summary: string;
  package: string;
  section: string;
  /**
   * The installed version of the package carrying the page.
   */
  version: string;
  /**
   * Absolute path of the page on disk.
   */
  path: string;
}

/**
 * The docs pages the project's installed Alepha packages ship (#E91).
 *
 * Each of `alepha` and the `@alepha/*` packages carries its pages at
 * `node_modules/<package>/docs/<slug>.md` (written by the framework's
 * `yarn build`, see `package:docs`), with a small front matter giving the
 * slug, title, one-line summary, package and section. This reads them from
 * the project, so what an agent learns is the version the project installed,
 * and only for what it installed.
 *
 * Packages are resolved the way Node resolves them: `node_modules` in the
 * project root, then in each parent directory, the closest copy of a package
 * winning. That is what makes it work in a workspace app whose dependencies
 * are hoisted to the repository root.
 */
export class DocsLibrary {
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Every installed page, `alepha` first, then the scoped packages by name;
   * within a package, by section in the site's order, then by slug.
   */
  public async pages(root: string): Promise<DocsPage[]> {
    const pages: DocsPage[] = [];
    for (const dir of await this.packageDirs(root)) {
      const own = await this.readPackage(dir);
      own.sort(
        (a, b) =>
          this.sectionRank(a.section) - this.sectionRank(b.section) ||
          a.slug.localeCompare(b.slug),
      );
      pages.push(...own);
    }
    return pages;
  }

  /**
   * The site's order: what to read first comes first.
   */
  protected readonly sections = ["guides", "reference", "packages", "cli"];

  protected sectionRank(section: string): number {
    const rank = this.sections.indexOf(section);
    return rank < 0 ? this.sections.length : rank;
  }

  /**
   * One page by what an agent would type: its slug, its title (`$entity`,
   * `useForm`, also without the `$`), or the last part of its slug
   * (`server-cors` for `packages-alepha-server-cors`). Several matches of the
   * same strength are returned together, so the caller can list them.
   */
  public find(pages: DocsPage[], query: string): DocsPage[] {
    const q = query.trim().toLowerCase();
    const bare = q.replace(/^\$/, "");
    const tiers: Array<(page: DocsPage) => boolean> = [
      (page) => page.slug === q,
      (page) => page.title.toLowerCase() === q,
      (page) => page.title.toLowerCase().replace(/^\$/, "") === bare,
      (page) => page.slug.endsWith(`-${q}`),
      (page) => page.slug.endsWith(`-${bare}`),
    ];
    for (const tier of tiers) {
      const found = pages.filter(tier);
      if (found.length) {
        return found;
      }
    }
    return [];
  }

  /**
   * The pages closest to a query nobody matched, best first: a slug or title
   * containing it, then the nearest by edit distance to a title or to the
   * slug's last parts. Only near pages are kept, so a typo shows the page it
   * meant rather than four unrelated ones; with no near page, the `limit`
   * nearest are returned anyway.
   */
  public suggest(pages: DocsPage[], query: string, limit = 5): DocsPage[] {
    const q = query.trim().toLowerCase().replace(/^\$/, "");
    const near = Math.max(2, Math.floor(q.length / 3));
    const ranked = pages
      .map((page) => {
        const title = page.title.toLowerCase().replace(/^\$/, "");
        const tail = page.slug
          .split("-")
          .slice(-q.split("-").length)
          .join("-")
          .replace(/^\$/, "");
        const contains = page.slug.includes(q) || title.includes(q);
        const distance = Math.min(
          this.distance(q, tail),
          this.distance(q, title),
        );
        return { page, score: contains ? -1 : distance };
      })
      .sort(
        (a, b) => a.score - b.score || a.page.slug.localeCompare(b.page.slug),
      );
    const close = ranked.filter((entry) => entry.score <= near);
    return (close.length ? close : ranked)
      .slice(0, limit)
      .map((entry) => entry.page);
  }

  /**
   * A page's body, front matter removed, word for word otherwise.
   */
  public async read(page: DocsPage): Promise<string> {
    return this.body(await this.fs.readTextFile(page.path));
  }

  /**
   * Every body line containing `text`, case-insensitively, as
   * `{ page, line, text }`.
   */
  public async grep(
    pages: DocsPage[],
    text: string,
  ): Promise<Array<{ page: DocsPage; line: number; text: string }>> {
    const needle = text.toLowerCase();
    const matches: Array<{ page: DocsPage; line: number; text: string }> = [];
    for (const page of pages) {
      const source = await this.fs.readTextFile(page.path);
      const offset = this.frontMatterLines(source);
      const lines = source.split("\n");
      for (let i = offset; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({ page, line: i + 1, text: lines[i] });
        }
      }
    }
    return matches;
  }

  /**
   * `node_modules/alepha` and every `node_modules/@alepha/*` that carries a
   * `docs/` folder, nearest copy first, from the project root up.
   */
  protected async packageDirs(root: string): Promise<string[]> {
    const found = new Map<string, string>();
    let dir = this.fs.resolve(root);
    while (true) {
      const modules = this.fs.join(dir, "node_modules");
      const candidates = [this.fs.join(modules, "alepha")];
      const scope = this.fs.join(modules, "@alepha");
      if (await this.fs.exists(scope)) {
        for (const name of (await this.fs.ls(scope)).sort()) {
          candidates.push(this.fs.join(scope, name));
        }
      }
      for (const candidate of candidates) {
        const name = await this.packageName(candidate);
        if (
          name &&
          !found.has(name) &&
          (await this.fs.exists(this.fs.join(candidate, "docs")))
        ) {
          found.set(name, candidate);
        }
      }
      const parent = this.fs.resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
    return [...found.values()];
  }

  protected async packageName(dir: string): Promise<string | undefined> {
    const file = this.fs.join(dir, "package.json");
    if (!(await this.fs.exists(file))) {
      return undefined;
    }
    const pkg = await this.fs.readJsonFile<{ name?: string }>(file);
    return pkg.name;
  }

  protected async readPackage(dir: string): Promise<DocsPage[]> {
    const pkg = await this.fs.readJsonFile<{ name: string; version?: string }>(
      this.fs.join(dir, "package.json"),
    );
    const docsDir = this.fs.join(dir, "docs");
    const pages: DocsPage[] = [];
    for (const file of (await this.fs.ls(docsDir)).sort()) {
      if (!file.endsWith(".md")) continue;
      const path = this.fs.join(docsDir, file);
      const meta = this.frontMatter(await this.fs.readTextFile(path));
      pages.push({
        slug: meta.slug ?? file.replace(/\.md$/, ""),
        title: meta.title ?? file.replace(/\.md$/, ""),
        summary: meta.summary ?? "",
        package: meta.package ?? pkg.name,
        section: meta.section ?? "",
        version: pkg.version ?? "",
        path,
      });
    }
    return pages;
  }

  /**
   * The `key: "json string"` lines between the leading `---` fences.
   */
  protected frontMatter(source: string): Record<string, string> {
    const meta: Record<string, string> = {};
    const lines = source.split("\n");
    const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
    for (const line of lines.slice(1, Math.max(close, 1))) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (!match) continue;
      try {
        meta[match[1]] = String(JSON.parse(match[2]));
      } catch {
        meta[match[1]] = match[2];
      }
    }
    return meta;
  }

  /**
   * How many leading lines the front matter and the blank line after it
   * take; 0 when the page has none.
   */
  protected frontMatterLines(source: string): number {
    if (!source.startsWith("---\n")) {
      return 0;
    }
    const lines = source.split("\n");
    const close = lines.indexOf("---", 1);
    if (close < 0) {
      return 0;
    }
    return lines[close + 1] === "" ? close + 2 : close + 1;
  }

  protected body(source: string): string {
    return source.split("\n").slice(this.frontMatterLines(source)).join("\n");
  }

  /**
   * Levenshtein distance, for suggestions.
   */
  protected distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const next = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        prev = next;
      }
    }
    return row[b.length];
  }
}
