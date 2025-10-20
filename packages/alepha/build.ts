import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

main();

async function main() {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));

  pkg.exports = {
    ".": {
      import: "./core.js",
      require: "./core.cjs",
      types: "./core.d.ts",
    },
  };
  pkg.keywords = ["alepha"];

  for (const dep of Object.keys(pkg.dependencies)) {
    if (dep.startsWith("@alepha/")) {
      const name = dep.replace("@alepha/", "");
      const filename = name.split("-").slice(-1).join("");
      const directory = name.includes("-")
        ? name.split("-").slice(0, 1).join("/")
        : "";
      if (directory) {
        await mkdir(directory, { recursive: true });
      }
      await writeFile(
        join(directory, `${filename}.d.ts`),
        content(name, "d.ts"),
      );
      await writeFile(join(directory, `${filename}.cjs`), content(name, "cjs"));
      await writeFile(join(directory, `${filename}.js`), content(name, "js"));

      const root = directory ? `./${directory}` : ".";

      pkg.exports[`./${name.replaceAll("-", "/")}`] = {
        import: `${root}/${filename}.js`,
        require: `${root}/${filename}.cjs`,
        types: `${root}/${filename}.d.ts`,
      };

      pkg.keywords.push(name);
    }
  }

  await writeFile("package.json", `${JSON.stringify(pkg, null, "\t")}\n`);

  await improveTypingsIndex();
}

async function improveTypingsIndex() {
  const root = join("..");
  const packages = await readdir(root);
  for (const name of packages) {
    const dist = join(root, name, "dist/index.d.ts");
    const index = name.includes("-")
      ? join(root, "alepha", `${name.replace("-", "/")}.d.ts`)
      : join(root, "alepha", `${name}.d.ts`);

    if (existsSync(dist) && existsSync(index)) {
      let content = await readFile(dist, "utf-8");
      // replace 'declare module "@alepha/core" { ... }'
      // with 'declare module "alepha" { ... }'
      // in order to have Env typings when working with alepha
      content = content.replaceAll('"@alepha/core"', '"alepha"');
      content = content.replaceAll(/"@alepha\/(.*)?"/g, (_, args) => {
        return `"alepha/${args.replaceAll("-", "/")}"`;
      });
      await writeFile(index, content);
    }
  }
}

function content(name: string, type: "d.ts" | "js" | "cjs"): string {
  if (type === "d.ts") {
    return `export * from '@alepha/${name}';\n`;
  }
  if (type === "js") {
    return `export * from '@alepha/${name}'\n`;
  }
  // cjs
  return `'use strict';
var m = require('@alepha/${name}');
Object.keys(m).forEach(function (k) {
\tif (k !== 'default' && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
\t\tenumerable: true,
\t\tget: function () { return m[k]; }
\t});
});`;
}
