import { $command } from "alepha/command";
import { $context, Alepha } from "alepha";
import { changelogOptions } from "alepha/cli";

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
      "roadmap/api"
    ],
  });

  return {
    clean: $command({
      description: "Will remove all generated files.",
      handler: async ({ run }) => {
        await run("yarn convert ts");

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

        await run("yarn");
        await run("yarn copy");
      },
    }),
    verify: $command({
      aliases: ["v"],
      description: "Run linter, checker and tests.",
      handler: async ({ run }) => {
        await run(`yarn clean`);
        await run(`yarn lint`);
        await run(`yarn typecheck`);
        await run(`yarn test`);
        await run(`yarn check-dependencies`);
        await run(`yarn build`);
        await run(`yarn e2e`);
        await run(`yarn clean`);
      },
    }),
  };
};
