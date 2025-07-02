import { $command } from "../packages/cli/src/index.ts";
import { readdir } from "node:fs/promises";

export const clean = $command({
	when: ["clean", "c"],
	description: "Clean the project",
	handler: async ({ run }) => {
		await run("yarn convert ts");
		const p = "packages";
		await run("rm -rf coverage");
		await run(`rm -rf ${p}/**/dist ${p}/**/node_modules ${p}/**/coverage`);

		const a = `${p}/alepha`;
		await run(`rm -rf ${a}/*.js ${a}/*.cjs ${a}/*.d.ts`);
		await run(`rm -rf ${a}/**/*.js ${a}/**/*.cjs ${a}/**/*.d.ts`);
		const dirs = (await readdir(a, { withFileTypes: true }))
			.filter((d) => d.isDirectory())
			.map((d) => `${a}/${d.name}`)
		if (dirs.length) {
			await run(`rm -rf ${dirs.join(" ")}`);
		}

		await run("yarn");
	},
})
