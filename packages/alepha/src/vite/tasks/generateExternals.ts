import { mkdir, readFile, writeFile } from "node:fs/promises";
import m from "node:module";
import { join } from "node:path";

export interface GenerateExternalsOptions {
  /**
   * Output directory for package.json.
   */
  distDir: string;

  /**
   * List of external package names.
   */
  externals: string[];
}

/**
 * Generate minimal package.json with pinned external dependencies.
 *
 * This task creates a package.json in the dist directory containing
 * only the external dependencies needed at runtime, with their versions
 * pinned to the currently installed versions.
 */
export async function generateExternals(
  opts: GenerateExternalsOptions,
): Promise<void> {
  const require = m.createRequire(import.meta.filename);
  const deps: Record<string, string> = {};

  for (const dep of opts.externals) {
    try {
      const requirePath = require.resolve(dep);
      const pkgPath = `${requirePath.split(`node_modules/${dep}`)[0]}node_modules/${dep}/package.json`;
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      deps[dep] = `^${pkg.version}`;
    } catch (_err) {
      console.warn(`[generateExternals] Cannot find '${dep}' in node_modules`);
    }
  }

  const minimalPkg = {
    type: "module",
    main: "index.js",
    dependencies: deps,
  };

  await mkdir(opts.distDir, { recursive: true });

  const target = join(opts.distDir, "package.json");
  await writeFile(target, JSON.stringify(minimalPkg, null, 2), "utf-8");
}
