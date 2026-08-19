import { join, resolve } from "node:path";
import { $inject, AlephaError } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { DocsChecker, type DocUnit } from "./DocsChecker.ts";

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
  ];

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

      await run("compile marked examples", async () => {
        const units = await this.checker.collectCheckedFences(files);
        this.log.info(`${units.length} fences opted in with \`check\``);
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
}
