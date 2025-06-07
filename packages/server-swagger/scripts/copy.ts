import { existsSync } from "node:fs";
import { join } from "node:path";
import { fs, $, glob } from "zx";

$.shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";

const dirname = new URL(".", import.meta.url).pathname;
const root =
	process.platform === "win32" && dirname.startsWith("/")
		? dirname.slice(1)
		: dirname;

const assets = join(root, "../assets/swagger-ui");
let dist = join(root, "../../../../node_modules/swagger-ui-dist");

if (!existsSync(dist)) {
	dist = join(root, "../../../node_modules/swagger-ui-dist");
}

await fs.rm(assets, { recursive: true, force: true });
await fs.mkdir(assets, { recursive: true });
await fs.cp(dist, assets, { recursive: true });

const filesToRemove = [
	"NOTICE",
	"package.json",
	"LICENSE",
	"index.js",
	"swagger-initializer.js",
	"absolute-path.js",
	"README.md",
	"swagger-ui-es-bundle.js",
	"swagger-ui-es-bundle-core.js",
].map((item) => join(assets, item));

// Remove specified files
for (const file of filesToRemove) {
	await fs.rm(file, { force: true });
}

// Remove .map files
const mapFiles = await glob(join(assets, "*.map"));
for (const file of mapFiles) {
	await fs.rm(file, { force: true });
}
