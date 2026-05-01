import type { Alepha } from "alepha";
import { changelogOptions } from "alepha/cli";
import { $command } from "alepha/command";

export default (alepha: Alepha) => {
  // Type-safe changelog configuration
  alepha.set(changelogOptions, {
    ignore: [
      "project",
      "tests",
      "docs",
      "release",
      "task",
      "roadmap",
      "roadmap/api",
    ],
  });

  return {
    clean: $command({
      description: "Will remove all generated files.",
      handler: async ({ run }) => {
        await run.rm([
          `coverage`,
          `apps/*/playwright-report`,
          `apps/*/test-results`,
          `apps/*/dist`,
          `apps/*/node_modules`,
          `apps/*/coverage`,
          `packages/*/dist`,
          `packages/*/node_modules`,
          `packages/*/coverage`,
        ]);

        // When CI=true, yarn might create an immutable install, which is cool, but we don't need that here
        process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";

        await run("yarn");
      },
    }),
    verify: $command({
      aliases: ["v"],
      description: "Run linter, checker and tests.",
      handler: async ({ run }) => {
        // We need to force CI environment
        // -> tsdown has different behavior when run in CI
        process.env.CI = "true";

        await run(`yarn clean`);
        await run(`yarn copy`);
        await run(`yarn lint`);
        await run([`yarn typecheck`, `yarn test`, `yarn check-dependencies`]);
        await run(`yarn build`);

        // HACK: remove vite cache to prevent stale cache issues in e2e tests
        await run.rm([`apps/*/node_modules`]);
        await run([`yarn e2e`, `yarn e2e-cli`]);

        await run(`cd apps/docs && yarn alepha gen:llms`);
        await run(`yarn clean`);
        await run(`yarn copy`);
        await run(`yarn`);
      },
    }),
  };
};
