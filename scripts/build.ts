import { $command } from "../packages/cli/src/index.ts";
import { join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export const build = $command({
	when: ["build"],
	description: "Build libs with pkgroll",
	flags: {},
	handler: async ({ run }) => {
		await run("yarn convert js");
		await run(
			`yarn workspaces foreach -Apt --no-private run build`,
		);

		await improveTypingsIndex();
	},
})

async function improveTypingsIndex() {
	const root = join(process.cwd(), "packages");
	const packages = await readdir(root);
	for (const name of packages) {
		const dist = join(root, name, "dist/index.d.ts");
		const index =
			name.includes("-")
				? join(root, "alepha", `${name.replace("-", "/")}.d.ts`)
				: join(root, "alepha", `${name}.d.ts`);

		if (existsSync(dist) && existsSync(index)) {
			let content = await readFile(dist, "utf-8");
			// replace 'declare module "@alepha/core" { ... }'
			// with 'declare module "alepha" { ... }'
			// in order to have Env typings when working with alepha
			content = content.replace("module \"@alepha/core\"", "module \"alepha\"");
			content = content.replace("module \"@alepha/", "module \"alepha/");
			await writeFile(index, content);
		}
	}
}
