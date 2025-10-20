import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const dirname = new URL(".", import.meta.url).pathname;
const root =
  process.platform === "win32" && dirname.startsWith("/")
    ? dirname.slice(1)
    : dirname;

const assets = join(root, "../assets/swagger-ui").replace(/\\/g, "/");
const dist = createRequire(import.meta.url)
  .resolve("swagger-ui-dist")
  .replace("index.js", "");

// ---------------------------------------------------------------------------------------------------------------------

await fs.rm(assets, { recursive: true, force: true });
await fs.mkdir(assets, { recursive: true });
await fs.cp(dist, assets, { recursive: true });

// clean up unnecessary files
const filesToRemove = [
  "NOTICE",
  "package.json",
  "LICENSE",
  "index.js",
  "swagger-initializer.js",
  "absolute-path.js",
  "README.md",
  "swagger-ui.js",
  "swagger-ui-es-bundle.js",
  "swagger-ui-es-bundle-core.js",
].map((item) => join(assets, item));

for (const file of filesToRemove) {
  await fs.rm(file, { force: true });
}

for await (const item of fs.glob("*.map", { cwd: assets })) {
  await fs.rm(join(assets, item), { force: true });
}

for await (const item of fs.glob("*.txt", { cwd: assets })) {
  await fs.rm(join(assets, item), { force: true });
}
