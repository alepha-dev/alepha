import { $command } from "alepha/command";
import { t } from "alepha";
import { readFile } from "node:fs/promises";

export default () => {
  return {
    clean: $command({
      description: "Will remove all generated files.",
      handler: async ({ run }) => {
        await run("yarn convert ts");

        await run.rm([
          `coverage`,
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
    release: $command({
      description: "Release packages version (default: minor)",
      flags: t.object({
        major: t.optional(
          t.boolean({
            when: ["--major"],
            description: "Bump major version.",
          }),
        ),
        patch: t.optional(
          t.boolean({
            when: ["--patch"],
            description: "Bump patch version.",
          }),
        ),
      }),
      handler: async ({ flags, run }) => {
        // Check if authenticated to npm registry
        try {
          await run("npm whoami");
        } catch (error) {
          throw new Error(
            "Not authenticated to npm registry.\n" + "Run: npm login",
          );
        }

        if (await run(`git diff`)) {
          throw new Error(
            "You must commit file(s) before running the release script",
          );
        }

        await run("yarn clean");
        await run("yarn lint");
        await run("yarn typecheck");
        await run("yarn check-dependencies");
        await run("yarn test");
        await run("yarn build");

        if (await run("git diff")) {
          throw new Error(
            "You must commit file(s) before running the release script",
          );
        }

        const arg = Object.keys(flags).find(
          (it) => it in { major: true, patch: true },
        );

        await run(
          `yarn workspaces foreach --no-private --all version ${arg || "minor"}`,
        );

        await run("yarn convert js");
        await run(
          `yarn workspaces foreach --no-private -Apt exec npm publish --access=public`,
        );
        await run("yarn alepha clean");

        const version = await JSON.parse(
          await readFile("packages/alepha/package.json", "utf8"),
        ).version;

        await run(`git commit -am "release: ${version}"`);
        await run(`git tag -a ${version} -m "release: ${version}"`);
        await run("git push --follow-tags");
      },
    })
  };
};
