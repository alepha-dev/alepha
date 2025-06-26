import { createRequire } from "node:module";
import { join } from "node:path";
import { $, fs } from "zx";

$.shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";

const dirname = new URL(".", import.meta.url).pathname;
const root =
	process.platform === "win32" && dirname.startsWith("/")
		? dirname.slice(1)
		: dirname;

const libs = join(root, "../libs/drizzle-kit").replace(/\\/g, "/");
const dist = createRequire(import.meta.url)
	.resolve("drizzle-kit")
	.replace("index.js", "");

// ---------------------------------------------------------------------------------------------------------------------

await fs.rm(libs, { recursive: true, force: true });
await fs.mkdir(libs, { recursive: true });

const files = ["api.mjs", "api.d.mts"];

for (const file of files) {
	await fs.cp(`${dist}/${file}`, `${libs}/${file}`);
}
