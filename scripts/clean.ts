import { $command } from "../packages/cli/src/index.ts";
import { readdir } from "node:fs/promises";

export const clean = $command({
	when: ["clean", "c"],
	description: "Clean the project",
	handler: async ({ run }) => {
		await run("yarn convert ts");
		const p = "packages";
		const a = `${p}/alepha`;
		await run("rm -rf coverage");
		await run(`rm -rf ${p}/**/dist ${p}/**/node_modules ${p}/**/coverage`);
		const dirs = (await readdir(a))
			.filter((f) => f !== "src" && !f.includes(".") && f !== "LICENSE")
			.map((f) => `${a}/${f}`).join(" ");
		if (dirs.trim()) {
			await run(`rm -rf ${dirs}`);
		}
		await run(`rm -rf ${a}/*.js ${a}/*.cjs ${a}/*.map ${a}/*.d.ts`);
		await run("yarn");
	},
})
