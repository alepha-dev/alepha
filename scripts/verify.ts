import { $command } from "@alepha/cli";

export const verify = $command({
	when: ["verify", "v"],
	description: "Verify the project",
	handler: async ({ run }) => {
		await run("yarn");
		await run("yarn alepha clean");
		await run("yarn format");
		await run("yarn lint");
		await run("yarn check");
		await run("yarn check-dependencies");
		await run("yarn test");
		await run("yarn alepha build");
		await run("yarn alepha clean");
	},
})
