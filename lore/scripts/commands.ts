import { existsSync } from "node:fs";
import { join } from "node:path";

import { AlephaError, z } from "alepha";
import { $command } from "alepha/command";

/**
 * The repository's own commands: `clean` and `verify` / `v`. Each takes the
 * slot of a CLI built-in of the same name, since the CLI keeps the LAST
 * registration for a name and `defineConfig` registers its services after the
 * built-ins.
 */
export class LoreCommands {
  public readonly clean = $command({
    description: "Will remove all generated files.",
    handler: async ({ run }) => {
      await run.rm([
        `.e2e-tmp`,
        `coverage`,
        `apps/*/playwright-report`,
        `apps/*/test-results`,
        `apps/*/.playwright`,
        `apps/*/dist`,
        `apps/*/coverage`,
        `packages/*/*/dist`,
        `packages/*/*/node_modules`,
        `packages/*/*/coverage`,
      ]);
    },
  });

  /**
   * Everything CI runs that a laptop can: lint, typecheck, audits, unit
   * tests, then the build and both end-to-end suites. `--fast` stops after
   * the unit tests, the inner loop: it cannot catch a build failure, an SSR
   * regression or anything an e2e covers. Only the Docker image is left to CI.
   *
   * `e2e-cli` drives a real Bay, so it needs a Bay checkout: `BAY_DIR`, else
   * `.bay` (where CI clones it), else a sibling `../bay`.
   */
  public readonly verify = $command({
    aliases: ["v"],
    description:
      "Lint, typecheck, audits, unit tests, build and e2e. --fast stops after the unit tests.",
    flags: z.object({
      fast: z
        .boolean()
        .describe("Skip the build and the e2e suites")
        .optional(),
    }),
    exclusive: true,
    handler: async ({ run, flags, root }) => {
      process.env.CI = "true";
      process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";

      await run("yarn");
      await run("yarn lint");
      await run([
        "yarn typecheck",
        "yarn check:deps",
        "yarn check:conventions",
        "yarn check:i18n",
        "yarn check:migrations",
      ]);
      await run("yarn test");

      if (flags.fast) {
        return;
      }

      process.env.BAY_DIR = this.bayDir(root);

      await run("yarn build");
      await run("yarn e2e");
      await run("yarn e2e-cli");
    },
  });

  /**
   * The Bay checkout `e2e-cli` builds and runs. Refused up front rather than
   * after the build, since the suite never skips a missing Bay.
   */
  protected bayDir(root: string): string {
    const candidates = [
      process.env.BAY_DIR,
      join(root, ".bay"),
      join(root, "..", "bay"),
    ].filter((dir): dir is string => !!dir);

    const found = candidates.find((dir) => existsSync(join(dir, "go.mod")));
    if (!found) {
      throw new AlephaError(
        `No Bay checkout for e2e-cli (looked in ${candidates.join(", ")}). ` +
          "Clone github.com/alepha-dev/bay to .bay, set BAY_DIR, or run yarn v --fast.",
      );
    }
    return found;
  }
}
