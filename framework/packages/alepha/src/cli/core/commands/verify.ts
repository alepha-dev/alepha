import { $inject, Alepha } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

import { checkOptions } from "../atoms/checkOptions.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";

export class VerifyCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Whether the project has any tests to run.
   *
   * Vitest ships embedded in `alepha`, so it is not a project dependency and
   * cannot be detected that way. Gating on a `test/` directory alone missed
   * the framework's own co-located convention (`src/**\/*.spec.ts`) — such a
   * project got a green `alepha verify` having executed zero tests, which is
   * worse than no verification at all because it reports success.
   */
  protected async hasTests(root: string): Promise<boolean> {
    if (await this.utils.exists(root, "test")) {
      return true;
    }

    // A missing `src/` yields no entries rather than an error — `ls` is a raw
    // readdir and throws ENOENT.
    const entries = await this.fs
      .ls(this.fs.join(root, "src"), { recursive: true })
      .catch(() => [] as string[]);

    return entries.some((entry) => /\.spec\.(ts|tsx|js|jsx)$/.test(entry));
  }

  /**
   * Run a series of verification commands to ensure code quality and correctness.
   *
   * This command runs the following checks in order:
   * - Clean the project
   * - Format and lint the code (oxlint then oxfmt, one pass)
   * - Check the conventions (`alepha check`), unless the config says
   *   `check: false`
   * - Type check the code
   * - Run tests (skipped when the project has no spec files)
   * - Check database migrations (always; returns cleanly with no database)
   * - Build the project (skipped for Expo projects)
   * - Clean the project again
   */
  public readonly verify = $command({
    name: "verify",
    description: "Verify the Alepha project",
    handler: async ({ root, run }) => {
      await run("alepha clean");
      await run("alepha lint");

      // Between lint and typecheck: a convention finding is cheaper to read
      // than a type error, and often explains one. On in every app, an
      // upgraded one included, with no key to opt in: only `check: false`
      // removes the step, and `alepha check` typed by hand still runs.
      if (this.alepha.store.get(checkOptions)?.enabled !== false) {
        await run("alepha check");
      }

      await run("alepha typecheck");

      if (await this.hasTests(root)) {
        await run("alepha test");
      }

      // Unconditional on purpose. This used to be gated on a `migrations/`
      // directory existing, which inverted the check: a project that had
      // generated migrations was verified, and one with entities and no
      // migrations at all — the state that ships a server which boots green
      // and 500s on its first query — was waved through. The command itself
      // returns cleanly when the app has no database, so there is nothing
      // left for a gate to protect.
      await run("alepha db migrations check");

      const isExpo = await this.pm.hasExpo(root);
      if (!isExpo) {
        await run("alepha build");
      }
      await run("alepha clean");
    },
  });
}
