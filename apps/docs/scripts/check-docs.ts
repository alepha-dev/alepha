import { join, resolve } from "node:path";

import { $inject, AlephaError } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";

import { DocsChecker, type DocUnit } from "./DocsChecker.ts";
import { snippets } from "./snippets.ts";

/**
 * Verifies the documentation against the framework it documents.
 *
 * Two layers, deliberately unequal in ambition:
 *
 * 1. **Banned symbols**: a whole-word scan of every line of every doc,
 *    prose included. Milliseconds, 100% coverage, catches the failure that
 *    motivated this command: the docs told every AI to import `t` from
 *    `alepha` for months after `t` was deleted.
 *
 *    "Every doc" means more than `docs/`. The same `t` survived in the root
 *    README, in the package README that npm renders, and in the AGENTS.md
 *    template shipped to users, that last one being how an assistant learns
 *    the API in the first place. A scan that stops at `docs/` misses the
 *    three files most likely to be read.
 *
 * 2. **Compiled fences**: TypeScript blocks that opt in with a `check`
 *    marker (```ts check) are compiled against the real framework types.
 *    Opt-in rather than blanket, because two thirds of the fences in
 *    `docs/1-guides` deliberately omit imports and build on symbols defined
 *    in an earlier block on the page; compiling those would be all noise.
 *    A fence earns the marker by becoming self-contained - which also makes
 *    it copy-pasteable, so the incentive points the right way.
 */
export class CheckDocsCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly checker = $inject(DocsChecker);

  /**
   * `docs/superpowers/` is an archive of past plans - a record of what was
   * true when it was written, not a claim about the framework today.
   */
  protected readonly excluded = ["superpowers"];

  /**
   * Documentation that lives outside `docs/`, in reach order: the repository
   * front page, the page npm renders, and the framework brief an AI assistant
   * reads out of `node_modules` - `release.yml` copies that last one to
   * `packages/alepha/AGENTS.md` and `CLAUDE.md` on the way to the registry.
   *
   * Not to be confused with `cli/core/templates/agentMd.ts`, which is the
   * per-project brief `alepha init` writes into a scaffolded app. Different
   * document, different audience, and being a `.ts` file it is out of reach
   * of this check.
   */
  protected readonly extraDocs = [
    "README.md",
    "packages/alepha/README.md",
    "packages/alepha/assets/agents-template.md",
    // The llms.txt preamble: the page assistants read first, and the one
    // whose entry-point sample passed a module as `run()` options unnoticed.
    "apps/docs/public/llms-index.md",
    // Private, so not under the scoped-package root below.
    "packages/create-alepha/README.md",
  ];

  /**
   * Where the per-package READMEs live, scanned as a group.
   *
   * `packages/alepha/README.md` was listed by hand above and every OTHER
   * package README was not, which is a distinction npm does not make: each of
   * these is the page a package renders on the registry. `@alepha/lore`'s
   * spent weeks documenting a `SIGIL_SINK` variable that had been folded into
   * a config field, while this command carried a rule banning that exact
   * string and never looked at the file.
   *
   * A directory rather than more hand-listed paths, so a new package is
   * covered by existing.
   */
  protected readonly packageDocsRoot = "packages/@alepha";

  check = $command({
    name: "check:docs",
    description: "Check the docs for stale symbols and compile marked examples",
    handler: async ({ run }) => {
      const root = resolve(import.meta.dirname, "../../..");
      const docsDir = join(root, "docs");

      let files: string[] = [];
      await run("scan docs", async () => {
        files = await this.listMarkdown(docsDir);

        for (const relative of this.extraDocs) {
          const path = join(root, relative);
          if (await this.fs.exists(path)) {
            files.push(path);
          }
        }

        files.push(...(await this.packageReadmes(root)));

        this.log.info(`Scanning ${files.length} markdown files`);
      });

      let failures = 0;

      await run("banned symbols", async () => {
        const violations = await this.checker.check(files);
        for (const it of violations) {
          this.log.error(
            `${it.file.replace(`${root}/`, "")}:${it.line} - ${it.message}`,
          );
        }
        failures += violations.length;
        this.log.info(`${violations.length} banned-symbol violations`);
      });

      await run("internal links", async () => {
        const dangling = await this.danglingLinks(files, root);
        for (const it of dangling) {
          this.log.error(it);
        }
        failures += dangling.length;
        this.log.info(`${dangling.length} dangling internal link(s)`);
      });

      await run("primitive guide coverage", async () => {
        const { regressions, healed, uncovered } =
          await this.primitiveCoverage(root);
        for (const it of regressions) {
          this.log.error(it);
        }
        for (const it of healed) {
          this.log.error(it);
        }
        failures += regressions.length + healed.length;
        this.log.warn(
          `${uncovered.length} primitive(s) still have a reference page and no guide`,
        );
      });

      await run("compile marked examples", async () => {
        const units = [
          ...(await this.checker.collectCheckedFences(files)),
          ...this.snippetUnits(),
        ];
        this.log.info(
          `${units.length} units to compile (fences opted in with \`check\`, plus the snippets not marked uncheckable)`,
        );
        if (units.length === 0) {
          return;
        }
        const errors = await this.compile(units, root);
        for (const it of errors) {
          this.log.error(it);
        }
        failures += errors.length;
      });

      if (failures > 0) {
        // Throw: the CLI only exits non-zero when the handler throws, so a
        // logged-and-returned failure would report success to CI.
        throw new AlephaError(`check:docs found ${failures} problem(s)`);
      }
    },
  });

  /**
   * Compile every opted-in fence in ONE `tsc` pass.
   *
   * Each fence becomes its own file - they are independent examples, and a
   * shared module would make one fence's `const alepha` collide with the
   * next. Files land inside the app's own `node_modules/.alepha` so that
   * `import ... from "alepha"` resolves exactly as it does for a real
   * consumer, rather than through a hand-built paths mapping that could
   * drift from what users actually get.
   */
  protected async compile(units: DocUnit[], root: string): Promise<string[]> {
    const workDir = join(
      import.meta.dirname,
      "../node_modules/.alepha/docs-check",
    );
    await this.fs.rm(workDir, { recursive: true, force: true });
    await this.fs.mkdir(workDir);

    const byFileName = new Map<string, DocUnit>();
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      // Always `.tsx`, whatever the fence is labelled. Plenty of blocks are
      // tagged ```typescript and contain JSX, and in a `.ts` file that is a
      // syntax error before any type is checked (TS1005 "'>' expected") -
      // which reads as "the example is broken" when it is only mislabelled.
      // TSX is a superset apart from `<T>value` assertions, which this
      // codebase does not use.
      const name = `example-${String(i).padStart(4, "0")}.tsx`;
      byFileName.set(name, unit);
      // `export {}` guarantees module scope even for a fence that declares
      // nothing - without it two fences sharing a `const` name collide in
      // the global scope.
      await this.fs.writeFile(
        join(workDir, name),
        `${unit.code}\nexport {};\n`,
      );
    }

    await this.fs.writeFile(
      join(workDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          extends: "../../../../../tsconfig.json",
          compilerOptions: { noEmit: true, jsx: "react-jsx" },
          include: ["*.ts", "*.tsx"],
        },
        null,
        2,
      )}\n`,
    );

    const tsc = join(root, "node_modules/typescript/bin/tsc");
    const output = await this.shell
      .run(`node --max-old-space-size=4096 "${tsc}" -p "${workDir}"`, {
        capture: true,
      })
      .catch((error: unknown) =>
        String((error as { stdout?: string }).stdout ?? error),
      );

    return this.mapErrors(String(output), byFileName, root);
  }

  /**
   * Rewrite `example-0007.ts(3,14): error TS2305: ...` into a location in the
   * markdown the fence came from. A compiler error pointing at a generated
   * temp file is useless to whoever has to fix the doc.
   */
  protected mapErrors(
    output: string,
    byFileName: Map<string, DocUnit>,
    root: string,
  ): string[] {
    const errors: string[] = [];

    for (const line of output.split("\n")) {
      // Match the basename ANYWHERE in the line: tsc reports paths relative
      // to its own cwd, so anchoring on the basename silently matched
      // nothing and the command reported a clean run over a failing corpus.
      const match = /(example-\d+\.tsx?)\((\d+),(\d+)\):\s*(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      const unit = byFileName.get(match[1]);
      if (!unit) {
        continue;
      }
      // +1: the fence body starts on the line after the opening delimiter.
      const docLine = unit.line + Number(match[2]);
      errors.push(
        `${unit.file.replace(`${root}/`, "")}:${docLine} - ${match[4]}`,
      );
    }

    return errors;
  }

  /**
   * Every `/docs/reference-*` link in our own markdown resolves to a page the
   * site actually generates.
   *
   * The generated `@alepha/ui` README advertised
   * `/docs/reference-react-hooks-useismobile` while nothing produced that
   * page, so the one link a reader would follow to learn about the hook 404'd.
   * It is the failure a docs pipeline is worst at noticing: the README is
   * GENERATED, so it looked correct and internally consistent, and only
   * someone clicking the link would ever find out.
   *
   * Resolved against the file names `gen-docs` writes under
   * `docs/framework/2-reference`, not against the site's routing table -
   * `gen-tree` turns exactly those names into slugs, so this is one
   * indirection closer to the thing being asserted and it works without
   * building the site.
   *
   * Both spellings are matched: the site-relative `/docs/…` of the module
   * pages and the absolute `https://alepha.dev/docs/…` of the package READMEs.
   * Scoped to `reference-` slugs, which are the ones derivable from a
   * directory listing; a link into `guides-` or `packages-` is left alone
   * rather than guessed at.
   */
  /**
   * The home page's snippets, as compile units.
   *
   * Opt-OUT, unlike the markdown fences, which compile only where a `check`
   * marker asks them to. The default is inverted here because the failure was
   * silence: an `infra` snippet sat in this registry importing a `$storage`
   * that exists nowhere in the framework and passing `ttl: "5m"` where a
   * `DurationLike` tuple is required - three type errors in twenty lines,
   * unrendered and unnoticed, because being unused and being broken look
   * identical from outside. A new snippet is therefore compiled unless
   * somebody writes down why it cannot be.
   *
   * `uncheckable` is that reason, and it is a sentence rather than a boolean
   * so the exemption has to argue for itself. The three that carry one are
   * excerpts: they omit imports on purpose, so that what the visitor reads is
   * the shape rather than the ceremony.
   */
  /**
   * Primitives that have a generated reference page and appear in no guide.
   *
   * A reference page states a signature; a guide is where a reader meets the
   * thing and sees why they would reach for it. This list is empty, and every
   * entry it used to hold was removed by writing the guide rather than by
   * deleting the line.
   *
   * It stays as a list because the mechanism is the point. Empty, it is a
   * gate: a new primitive that ships with a reference page and no guide fails
   * the build. Adding a name re-opens the ratchet for that one primitive,
   * which is the right move when a guide is genuinely a separate piece of
   * work, and the wrong move as a way past a failing check.
   *
   * ⚠️ Whatever you add here, remove it once its guide exists. A stale entry
   * silently re-permits the gap if the guide is ever deleted, so `healed`
   * below fails on exactly that.
   *
   * Guides cover families rather than primitives, which is why 30 names came
   * off this list as five new pages plus a handful of sections folded into
   * guides that already existed: the eight `$auth*` shorthands are one table
   * in the authentication guide, and the resilience decorators
   * (`$retry`, `$throttle`, `$debounce`, `$timeout`, `$circuit`, `$memoize`,
   * `$batch`) are one page with `$pipeline`, the thing that hosts them.
   */
  protected readonly primitivesWithoutGuide: string[] = [];

  /**
   * Compares the primitives with no guide mention against the baseline above.
   *
   * Mentioned, not documented: a name appearing anywhere in `1-guides` counts.
   * The check is deliberately weak because the strong version cannot be
   * automated - "is this explained well" is not a grep - and a weak check that
   * runs beats a strong one that does not exist.
   */
  protected async primitiveCoverage(root: string): Promise<{
    regressions: string[];
    healed: string[];
    uncovered: string[];
  }> {
    const dir = join(root, "docs/framework/2-reference/1-primitives");
    if (!(await this.fs.exists(dir))) {
      return { regressions: [], healed: [], uncovered: [] };
    }

    const primitives = (await this.fs.ls(dir))
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.replace(/\.md$/, ""));

    const guides = await this.listMarkdown(
      join(root, "docs/framework/1-guides"),
    );
    const corpus = (
      await Promise.all(guides.map((file) => this.fs.readFile(file)))
    )
      .map(String)
      .join("\n");

    const uncovered = primitives.filter(
      // `\b` after the name, so `$auth` is not considered covered by a guide
      // that only ever mentions `$authGoogle`.
      (name) => !new RegExp(`\\${name}\\b`).test(corpus),
    );

    const allowed = new Set(this.primitivesWithoutGuide);
    const regressions = uncovered
      .filter((name) => !allowed.has(name))
      .map(
        (name) =>
          `${name} has a reference page and is named in no guide - write one, or add it to primitivesWithoutGuide in apps/docs/scripts/check-docs.ts`,
      );

    const stillUncovered = new Set(uncovered);
    const healed = this.primitivesWithoutGuide
      .filter((name) => !stillUncovered.has(name))
      .map(
        (name) =>
          `${name} is documented now - remove it from primitivesWithoutGuide in apps/docs/scripts/check-docs.ts`,
      );

    return { regressions, healed, uncovered };
  }

  protected snippetUnits(): DocUnit[] {
    return Object.entries(snippets)
      .filter(([, snippet]) => !("uncheckable" in snippet))
      .map(([name, snippet]) => ({
        file: `apps/docs/scripts/snippets.ts#${name}`,
        line: 1,
        code: snippet.content,
        lang: "tsx",
      }));
  }

  protected async danglingLinks(
    files: string[],
    root: string,
  ): Promise<string[]> {
    const slugs = new Set<string>();
    const sources: Array<[string, string]> = [
      ["1-primitives", "reference-primitives-"],
      ["2-react-hooks", "reference-react-hooks-"],
      ["3-providers", "reference-providers-"],
    ];

    for (const [dir, prefix] of sources) {
      const from = join(root, "docs/framework/2-reference", dir);
      if (!(await this.fs.exists(from))) continue;
      for (const name of await this.fs.ls(from)) {
        if (name.endsWith(".md")) {
          slugs.add(`${prefix}${name.replace(/\.md$/, "")}`.toLowerCase());
        }
      }
    }

    const problems: string[] = [];
    const link =
      /\]\((?:https:\/\/alepha\.dev)?\/docs\/(reference-[a-z0-9$@.-]+)\)/gi;

    for (const file of files) {
      const content = String(await this.fs.readFile(file));
      for (const [index, line] of content.split("\n").entries()) {
        for (const match of line.matchAll(link)) {
          if (!slugs.has(match[1].toLowerCase())) {
            problems.push(
              `${file.replace(`${root}/`, "")}:${index + 1} - /docs/${match[1]} is linked but no reference page generates it`,
            );
          }
        }
      }
    }
    return problems;
  }

  protected async listMarkdown(dir: string): Promise<string[]> {
    const entries = await this.fs.ls(dir, { recursive: true });

    return entries
      .filter((entry) => entry.endsWith(".md"))
      .filter(
        (entry) => !this.excluded.some((it) => entry.startsWith(`${it}/`)),
      )
      .map((entry) => join(dir, entry))
      .sort();
  }

  /**
   * The README of every package under `packages/@alepha`, and only those.
   *
   * One level deep on purpose. A recursive walk would pull in whatever README
   * happens to sit in a fixture or a template directory inside a package,
   * which is a document with a different audience and no reason to obey the
   * registry's rules.
   */
  protected async packageReadmes(root: string): Promise<string[]> {
    const dir = join(root, this.packageDocsRoot);
    if (!(await this.fs.exists(dir))) {
      return [];
    }

    const found: string[] = [];
    for (const entry of await this.fs.ls(dir)) {
      const path = join(dir, entry, "README.md");
      if (await this.fs.exists(path)) {
        found.push(path);
      }
    }
    return found.sort();
  }
}
