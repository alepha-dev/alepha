import { promises as fs } from "node:fs";
import m from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

export interface ViteAlephaExternalsVersionOptions {
  distDir?: string; // where to write the minimal package.json
}

export function viteAlephaExternalsVersion(
  options: ViteAlephaExternalsVersionOptions = {},
): Plugin {
  const outDir = options.distDir || "dist";
  let config: any;

  const require = m.createRequire(import.meta.filename);
  return {
    name: "vite-externals-version",
    apply: "build",
    configResolved: (c) => {
      config = c;
    },
    async closeBundle() {
      const externals: string[] = config?.ssr?.external ?? [];
      const deps: Record<string, string> = {};

      for (const dep of externals) {
        try {
          const requirePath = require.resolve(dep);
          const pkgPath = `${requirePath.split(`node_modules/${dep}`)[0]}node_modules/${dep}/package.json`;
          const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
          deps[dep] = `^${pkg.version}`;
        } catch (err) {
          console.warn(
            `[vite-externals-version] Cannot find '${dep}' in node_modules`,
          );
        }
      }

      const minimalPkg = {
        type: "module",
        main: "index.js",
        dependencies: deps,
      };

      await fs.mkdir(outDir, { recursive: true });

      const target = path.join(outDir, "package.json");
      await fs.writeFile(target, JSON.stringify(minimalPkg, null, 2), "utf-8");
    },
  };
}
