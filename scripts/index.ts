import { readdir, readFile } from "node:fs/promises";
import { $command } from "@alepha/command";
import { Alepha, run, t } from "@alepha/core";

class AlephaDevCli {
	clean = $command({
		description: "Will remove all generated files.",
		handler: async ({ run }) => {
			await run("yarn convert ts");

			await run.rm([
				`packages/*/dist`,
				`packages/*/node_modules`,
				`packages/*/coverage`,
			]);

			await run.rm([
				`packages/alepha/**/*.js`,
				`packages/alepha/**/*.cjs`,
				`packages/alepha/**/*.d.ts`,
				`packages/alepha/**/*.map`,
			]);

			const dirs = await readdir("packages/alepha", {
				withFileTypes: true,
			}).then((entries) =>
				entries
					.filter((d) => d.isDirectory())
					.map((d) => `packages/alepha/${d.name}`),
			);

			if (dirs.length) {
				await run.rm(dirs);
			}

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
			await run([`yarn check`, `yarn check-dependencies`]);
			await run(`yarn test`);
			await run(`yarn build`);
			await run(`yarn clean`);
		},
	});

	release = $command({
		description: "Release packages version (default: minor)",
		flags: t.object({
			registry: t.optional(
				t.string({
					when: ["--registry"],
					description: "NPM registry URL.",
				}),
			),
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
			if (await run(`git diff`)) {
				throw new Error(
					"You must commit file(s) before running the release script",
				);
			}

			await run("yarn clean");
			await run("yarn lint");
			await run("yarn check");
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
			const registry = flags.registry ? `--registry ${flags.registry}` : "";
			await run(
				`yarn workspaces foreach --no-private -Apt exec npm publish --access=public ${registry}`,
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
		LOG_FORMAT: "cli",
		LOG_LEVEL: "alepha.command:info,warn",
		CLI_NAME: "yarn alepha",
		CLI_DESCRIPTION: "Alepha development CLI 🛠️",
	},
});

alepha.with(AlephaDevCli);

run(alepha);
