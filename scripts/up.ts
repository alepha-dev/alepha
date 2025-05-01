import { $command } from "@alepha/cli";

export const up = $command({
	when: ["up"],
	description: "Up packages version (default: minor)",
	flags: {
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
		const arg = Object.keys(flags).find(
			(it) => it in { major: true, patch: true },
		);
		await run(
			`yarn workspaces foreach --no-private --all version ${arg || "minor"}`,
		);
	},
})
