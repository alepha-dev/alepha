import { $command } from "../packages/cli/src/index.ts";

export const clean = $command({
	when: ["clean", "c"],
	description: "Clean the project",
	handler: async ({ run }) => {
		await run("yarn convert ts");
		await run("rm -rf packages/**/dist");
		await run("rm -rf packages/**/node_modules");
		await run("rm -rf packages/**/coverage");
		await run("rm -rf coverage");
	},
})
