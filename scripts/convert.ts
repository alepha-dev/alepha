import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

main(process.argv[2]).catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Convert exports in package.json to the specified format.
 *
 * If you want to develop in TypeScript, you can convert the exports to "ts" format.
 * It will expose package.json as TypeScript mono-repo friendly.
 *
 * If you want to publish the package, you can convert the exports to "js" format.
 * It will expose package.json as JavaScript universal package.
 *
 * If you don't specify the format, it will convert the exports to the opposite format.
 *
 * Basic usage:
 * - clean project
 * - convert to js
 * - build project
 * - convert to ts
 */
async function main(to?: string) {
  const root = join(process.cwd(), "packages");
  const packages = await readdir(root);

  console.log(`Converting exports to ${to ?? "opposite"}`);

  for (const name of packages) {
    try {
      const pkgPath = join(root, name, "package.json");
      const json = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(json);

      if (
        pkg.private ||
        !pkg.scripts?.build ||
        (!pkg.main?.includes("dist") && !pkg.main?.includes("src") && !pkg.bin)
      ) {
        continue;
      }

      const action = to ?? (pkg.exports ? "ts" : "js");
      if (action === "ts") {
        const replace = (str: any) =>
          String(str).replace("dist/", "src/").replace(".js", ".ts");
        pkg.main = "./src/index.ts";
        pkg.types = "./src/index.ts";
        pkg.module = undefined;
        if (pkg.browser) {
          pkg.browser = "./src/index.browser.ts";
        }
        if (pkg.bin) {
          if (typeof pkg.bin === "string") {
            pkg.bin = replace(pkg.bin);
          } else {
            for (const [key, value] of Object.entries(pkg.bin)) {
              pkg.bin[key] = replace(value);
            }
          }
        }
        if (pkg.exports) {
          for (const value of Object.values(
            pkg.exports as Record<string, any>,
          )) {
            if (typeof value === "object") {
              value.types = replace(value.types);
              value.require = replace(value.require);
              value.import = replace(value.import);
              if (value.browser) {
                value.browser = replace(value.browser);
              }
            }
          }
        }
      } else {
        const replace = (str: any) =>
          String(str).replace("src/", "dist/").replace(".ts", ".js");
        pkg.main = "./dist/index.js";
        pkg.module = "./dist/index.js";
        pkg.types = "./dist/index.d.ts";
        if (pkg.browser) {
          pkg.browser = {
            "./dist/index.js": "./dist/index.browser.js",
          };
          pkg.exports["."].browser = "./dist/index.browser.js";
        }
        if (pkg.bin) {
          if (typeof pkg.bin === "string") {
            pkg.bin = replace(pkg.bin);
          } else {
            for (const [key, value] of Object.entries(pkg.bin)) {
              pkg.bin[key] = replace(value);
            }
          }
        }
        if (pkg.exports) {
          for (const value of Object.values(
            pkg.exports as Record<string, any>,
          )) {
            if (typeof value === "object") {
              value.types = replace(value.types);
              value.require = replace(value.require);
              value.import = replace(value.import);
              if (value.browser) {
                value.browser = replace(value.browser);
              }
            }
          }
        }
      }
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      console.log(`Patched ${name} to ${action}`);
    } catch (error) {
      console.error(`Failed to patch ${name}`, error);
    }
  }
}
