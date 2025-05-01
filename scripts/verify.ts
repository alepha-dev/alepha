import { $command } from "@alepha/cli";

export const verify = $command({
	when: ["verify", "v"],
	description: "Verify the project",
	handler: async ({ run }) => {
		await run("yarn format");
		await run("yarn lint");
		await run("yarn check");
		await run("yarn test");
	},
})
