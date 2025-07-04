import { readFile } from "node:fs/promises";
import { $command } from "../packages/cli/src/index.ts";

export const release = $command({
	when: ["release"],
	description: "Release packages version (default: minor)",
	flags: {
		registry: {
			when: ["--registry"],
			description: "NPM registry URL.",
		},
		dryRun: {
			when: ["--dry-run"],
			description:
				"Dry run. Do not publish anything. Just print what would be published.",
		},
		major: {
			when: ["--major"],
			description: "Bump major version.",
		},
		patch: {
			when: ["--patch"],
			description: "Bump patch version.",
		},
	},
	handler: async ({ run, flags }) => {
		if (await run("git diff")) {
			console.log(
				"Error - You must commit file(s) before running the release script.",
			);
			return;
		}

		await run("yarn clean");
		await run("yarn format");
		await run("yarn lint");
		await run("yarn check");
		await run("yarn check-dependencies");
		await run("yarn test");
		await run("yarn build");

		if (await run("git diff")) {
			console.log(
				"Error - You must commit file(s) before running the release script.",
			);
			return;
		}

		const arg = Object.keys(flags).find(
			(it) => it in { major: true, patch: true },
		);

		await run(
			`yarn workspaces foreach --no-private --all version ${arg || "minor"}`,
		);

		await run("yarn convert js");
		const registry = flags.registry ? `--registry ${flags.registry}` : "";
		const dryRunArg = flags.dryRun ? "--dry-run" : "";
		await run(
			`yarn workspaces foreach --no-private -Apt exec npm publish --access=public ${dryRunArg} ${registry}`,
		);
		await run("yarn alepha clean");

		const version = await getVersion();

		await run(`git commit -am "release: ${version}"`);
		await run(`git tag -a ${version} -m "release: ${version}"`);
		await run(`git push --follow-tags`);
	},
});

export async function getVersion() {
	const { version } = JSON.parse(
		await readFile("packages/alepha/package.json", "utf8"),
	);
	return version;
}
