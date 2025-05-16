import { $command } from "@alepha/cli";
import { build } from "./build.ts";

export const publish = $command({
	when: ["publish"],
	description: "Push all libs to npm registry",
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
	},
	handler: async ({ run, flags }) => {

		await build.handler({ run, flags });

		const registry = flags.registry ? `--registry ${flags.registry}` : "";
		const dryRunArg = flags.dryRun ? "--dry-run" : "";
		await run(
			`yarn workspaces foreach --no-private -Apt exec npm publish --access=public ${dryRunArg} ${registry}`
		);

		await run("yarn alepha clean");
	},
})
