import { type Alepha, t } from "alepha";
import { changelogOptions } from "alepha/cli";
import { $command } from "alepha/command";

export default (alepha: Alepha) => {
  // Type-safe changelog configuration
  alepha.set(changelogOptions, {
    ignore: ["project", "tests", "docs", "release", "task"],
  });

  return {
    clean: $command({
      description: "Will remove all generated files.",
      handler: async ({ run }) => {
        await run.rm([
          `coverage`,
          `apps/*/playwright-report`,
          `apps/*/test-results`,
          `apps/*/.playwright`,
          `apps/*/dist`,
          `apps/*/node_modules`,
          `apps/*/coverage`,
          `packages/*/dist`,
          `packages/*/node_modules`,
          `packages/*/coverage`,
        ]);
      },
    }),
    verify: $command({
      aliases: ["v"],
      description: "Run linter, checker and tests.",
      flags: t.object({
        fast: t.optional(
          t.boolean({
            description: "Skip build + e2e (faster local sanity check).",
          }),
        ),
      }),
      handler: async ({ run, flags }) => {
        // We need to force CI environment
        // -> tsdown has different behavior when run in CI
        process.env.CI = "true";

        // When CI=true, yarn might create an immutable install, which is cool, but we don't need that here
        process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";
        process.env.YARN_ENABLE_HARDENED_MODE = "false";

        await run("yarn");
        await run(`yarn clean`);
        await run(`yarn lint`);

        if (flags.fast) {
          await run([
            `yarn typecheck`,
            `yarn check:deps`,
            `yarn check:i18n`,
            `yarn check:migrations`,
          ]);
          await run([`yarn test`, `yarn test:bun`]);
          return;
        }

        await run(`yarn copy`);
        await run(`yarn check:deps`);
        await run(`yarn typecheck`);
        await run(`yarn test`);
        await run(`yarn test:bun`);
        await run(`yarn check:i18n`);
        await run(`yarn check:migrations`);
        await run(`yarn build`);

        // HACK: remove vite cache to prevent stale cache issues in e2e tests
        await run.rm([`apps/*/node_modules`]);
        await run(`yarn e2e`);
        await run(`yarn e2e-cli`);

        await run(`cd apps/docs && yarn alepha gen:llms`);
        await run(`yarn clean`);
        await run("yarn");
      },
    }),
  };
};
