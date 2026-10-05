import { dirname, join, normalize } from "node:path";

/**
 * Which `@lore` package may import which, and how.
 *
 * `apps/lore` is being split into four Alepha modules (#E75, folio #F1356):
 *
 * | package     | is               | may import  |
 * |-------------|------------------|-------------|
 * | `core`      | the glue         | nothing     |
 * | `work`      | Lore as Jira     | `core`      |
 * | `knowledge` | Lore as Obsidian | `core`      |
 * | `deploy`    | Lore as Vercel   | `core`      |
 *
 * A feature module never imports another one. A feature that spans two of
 * them (an epic files folios, a blight is forwarded to a quest, a release
 * lists its artifacts) goes through a core registry or a core link. The table
 * is {@link LorePackageGraph.GRAPH}; changing the direction is a one-line edit
 * there, and nowhere else.
 *
 * Beyond the graph, every import out of a package file obeys four rules:
 *
 * - **No deep import.** Another package is reached through a subpath its
 *   `exports` declares (`@lore/core/api`), never a file inside it.
 * - **`./web` stays browser-safe.** A file under `src/web` imports another
 *   package's `./api` or `./mcp` as `import type` only: a runtime import
 *   would bundle that package's server into the browser.
 * - **No package imports an app.** Neither `lore` (the app's own package
 *   name) nor a relative path out of the package.
 * - **No `@/`.** Vite reads the alias from `apps/lore/tsconfig.json` only, so
 *   a `@/` inside a package silently resolves into `apps/lore/src`.
 *
 * Read by `scripts/check-conventions.ts`; specified by
 * `scripts/lore-package-graph.spec.ts`.
 */
export class LorePackageGraph {
  /**
   * The allowed edges: each package, and the packages it may import.
   */
  public static readonly GRAPH: Record<string, string[]> = {
    core: [],
    work: ["core"],
    knowledge: ["core"],
    deploy: ["core"],
  };

  /**
   * The subpaths whose runtime values a `src/web` file may not import from
   * another package.
   */
  public static readonly SERVER_SUBPATHS = ["api", "mcp"];

  /**
   * Every static `import`/`export … from`, every side-effect `import "…"` and
   * every dynamic `import()`. Group 1 is the clause between the keyword and
   * `from`, group 2 the specifier of a static form, group 3 that of a
   * side-effect or dynamic one.
   */
  protected static readonly IMPORT =
    /(?:^|[\s;])(?:import|export)\s+([^;"']*?)\s*from\s*["']([^"']+)["']|(?:^|[^\w.])import\s*\(?\s*["']([^"']+)["']/g;

  /**
   * Each package's export subpaths without the leading `./` (`api`, `web`,
   * `testing`...), as its `package.json` declares them.
   */
  protected readonly exports: Record<string, string[]>;

  constructor(exports: Record<string, string[]>) {
    this.exports = exports;
  }

  /**
   * The package a repository path belongs to, or `undefined` when it is not
   * code of a `@lore` package: its `src/` and `test/`. A workspace's own
   * tooling (`vitest.config.ts`) reaches the repository's `scripts/` and is
   * not a module.
   */
  public packageOf(file: string): string | undefined {
    const match = /^packages\/@lore\/([^/]+)\/(?:src|test)\//.exec(file);
    return match?.[1];
  }

  /**
   * Every refusal for one file, each naming the file, the import and the
   * edge. Empty when the file is not in a `@lore` package or obeys the rule.
   */
  public check(file: string, source: string): string[] {
    const from = this.packageOf(file);
    if (!from) {
      return [];
    }

    const isWeb = file.startsWith(`packages/@lore/${from}/src/web/`);
    const violations: string[] = [];
    const refuse = (specifier: string, why: string) =>
      violations.push(`  ${file}\n    → "${specifier}": ${why}`);

    for (const match of source.matchAll(LorePackageGraph.IMPORT)) {
      const clause = match[1];
      const specifier = match[2] ?? match[3];
      if (!specifier) {
        continue;
      }
      const typeOnly = clause !== undefined && this.isTypeOnly(clause);

      if (specifier.startsWith("@/")) {
        refuse(
          specifier,
          "`@/` resolves into apps/lore/src from a package; import relatively inside the package, or `@lore/<pkg>/<subpath>` across packages",
        );
        continue;
      }

      if (specifier === "lore" || specifier.startsWith("lore/")) {
        refuse(
          specifier,
          `@lore/${from} -> apps/lore: no package imports an app`,
        );
        continue;
      }

      if (specifier.startsWith(".")) {
        const target = normalize(join(dirname(file), specifier));
        if (!target.startsWith(`packages/@lore/${from}/`)) {
          refuse(
            specifier,
            `a relative path out of @lore/${from}; another package is imported by its name, and an app never`,
          );
        }
        continue;
      }

      const named = /^@lore\/([^/]+)(?:\/(.*))?$/.exec(specifier);
      if (!named) {
        continue;
      }
      const [, to, subpath] = named;
      if (to === from) {
        continue;
      }

      if (!(to in this.exports)) {
        refuse(specifier, `@lore/${to} is not a @lore package`);
        continue;
      }

      if (!LorePackageGraph.GRAPH[from]?.includes(to)) {
        refuse(
          specifier,
          `@lore/${from} -> @lore/${to} is not an edge of the graph; a feature module imports @lore/core only, and a feature spanning two modules goes through a core registry or link`,
        );
        continue;
      }

      if (!subpath || !this.exports[to].includes(subpath)) {
        refuse(
          specifier,
          `@lore/${to} exports ${this.exports[to].map((s) => `./${s}`).join(", ")}; import through one of them, never past them`,
        );
        continue;
      }

      if (
        isWeb &&
        !typeOnly &&
        LorePackageGraph.SERVER_SUBPATHS.includes(subpath)
      ) {
        refuse(
          specifier,
          `@lore/${from} web -> @lore/${to}/${subpath} at runtime; web code imports ./${subpath} as \`import type\` only, and takes runtime values from ./schemas or ./web`,
        );
      }
    }

    return violations;
  }

  /**
   * Whether an import clause brings in types only: `import type {…}`,
   * `export type {…}`, or a braced list where every specifier says `type`.
   */
  protected isTypeOnly(clause: string): boolean {
    if (/^type\s/.test(clause)) {
      return true;
    }
    const braced = /^\{([^}]*)\}$/.exec(clause.trim());
    if (!braced) {
      return false;
    }
    const names = braced[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return names.length > 0 && names.every((name) => /^type\s/.test(name));
  }
}
