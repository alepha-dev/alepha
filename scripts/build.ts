import { $command } from "@alepha/cli";

export const build = $command({
	when: ["build"],
	description: "Build libs with pkgroll",
	flags: {},
	handler: async ({ run }) => {
		await run("yarn alepha clean");
		await run("yarn convert js");
		await run(
			`yarn workspaces foreach -Apt run build`,
		);
	},
})

