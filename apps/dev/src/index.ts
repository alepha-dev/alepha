import { readFile } from "node:fs/promises";
import { $command } from "alepha/command";
import { Alepha, run, t } from "alepha";

class AlephaDevCli {
  clean = $command({
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
  });

  verify = $command({
    aliases: ["v"],
    description: "Run linter, checker and tests.",
    handler: async ({ run }) => {
      await run(`yarn clean`);
      await run(`yarn lint`);
      await run(`yarn typecheck`);
      await run(`yarn test`);
      await run(`yarn check-dependencies`);
      await run(`yarn build`);
      await run(`yarn clean`);
    },
  });

  prerelease = $command({
    description:
      "Test release by publishing to local registry (http://localhost:4873)",
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
      // Check if local registry is accessible
      try {
        await run("npm ping --registry http://localhost:4873");
      } catch (error) {
        throw new Error(
          "Cannot connect to local registry at http://localhost:4873.\n" +
            "Make sure Verdaccio is running: docker-compose up -d verdaccio",
        );
      }

      // Check if authenticated to local registry
      try {
        await run("npm whoami --registry http://localhost:4873");
      } catch (error) {
        throw new Error(
          "Not authenticated to local registry.\n" +
            "Run: npm adduser --registry http://localhost:4873",
        );
      }

      await run("yarn clean");
      await run("yarn lint");
      await run("yarn typecheck");
      await run("yarn check-dependencies");
      await run("yarn test");
      await run("yarn build");

      const arg = Object.keys(flags).find(
        (it) => it in { major: true, patch: true },
      );

      await run(
        `yarn workspaces foreach --no-private --all version ${arg || "minor"}`,
      );

      await run("yarn convert js");
      await run(
        `yarn workspaces foreach --no-private -Apt exec npm publish --access=public --registry http://localhost:4873`,
      );
      await run("yarn alepha clean");

      const version = await JSON.parse(
        await readFile("packages/alepha/package.json", "utf8"),
      ).version;

      console.log(`\nPrerelease completed: ${version}`);
      console.log(`Published to: http://localhost:4873`);
      console.log(
        "\nNote: Version was bumped locally but not committed to git.",
      );
      console.log("Run 'git restore .' to reset version changes if needed.\n");
    },
  });

  release = $command({
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
  });
}

const alepha = Alepha.create({
  env: {
    LOG_FORMAT: "raw",
    LOG_LEVEL: "alepha.command:info,warn",
    CLI_NAME: "yarn alepha",
    CLI_DESCRIPTION: "Alepha development CLI 🛠️",
  },
});

alepha.with(AlephaDevCli);

run(alepha);
