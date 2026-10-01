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
   * The inner loop, and deliberately NOT the gate: push the branch, CI runs
   * the whole graph (checks, test, e2e x6, e2e-cli, docker) in a few minutes.
   *
   * It catches a typo, a bad import, a broken unit test, a missing i18n key or
   * migration. It cannot catch a build failure, an SSR regression or anything
   * an e2e covers.
   */
  public readonly verify = $command({
    aliases: ["v"],
    description:
      "Fast local checks: lint, typecheck, audits, unit tests. CI is the gate - push the branch.",
    exclusive: true,
    handler: async ({ run }) => {
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
    },
  });
}
