import { $command } from "../packages/cli/src/index.ts";

export const verify = $command({
	when: ["verify", "v"],
	description: "Verify the project",
	handler: async ({ run }) => {
		await run("yarn clean");
		await run("yarn lint");
		await run(["yarn check", "yarn check-dependencies"]);
		await run(["yarn test", "yarn build"]);
		await run("yarn clean");
	},
});
