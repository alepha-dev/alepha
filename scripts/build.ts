import { $command } from "@alepha/cli";
import { join } from "node:path";
import { copyFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export const build = $command({
	when: ["build"],
	description: "Build libs with pkgroll",
	flags: {},
	handler: async ({ run }) => {
		await run("yarn convert js");
		await run(
			`yarn workspaces foreach -Apt run build`,
		);

		await improveTypingsIndex();
	},
})

async function improveTypingsIndex() {
	const root = join(process.cwd(), "packages");
	const packages = await readdir(root);
	for (const name of packages) {
		const dist = join(root, name, "dist/index.d.ts");
		const alephaIndex =
			name.includes("-")
				? join(root, "alepha", `${name.replace("-", "/")}.d.ts`)
				: join(root, "alepha", `${name}.d.ts`);

		if (existsSync(dist) && existsSync(alephaIndex)) {
			await copyFile(dist, alephaIndex);
		}
	}
}
