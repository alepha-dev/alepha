import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { importAlepha } from "../helpers/importAlepha.ts";

export interface CopyAssetsOptions {
  /**
   * Entry point for the built Alepha application.
   */
  entry: string;

  /**
   * Output directory for copied assets.
   */
  distDir: string;
}

/**
 * Copy assets from Alepha packages to the build output directory.
 *
 * This task loads the built Alepha application, reads the
 * `alepha.build.assets` state to find packages with assets,
 * and copies their `/assets` directories to the build output.
 *
 * Used by modules like AlephaServerSwagger to distribute UI files.
 */
export async function copyAssets(opts: CopyAssetsOptions): Promise<void> {
  const root = process.cwd();
  const alepha = await importAlepha(opts.entry);
  const assets = alepha.state.get("alepha.build.assets");

  if (!assets || assets.length === 0) {
    return;
  }

  const require = createRequire(join(root, opts.entry));
  const buildAssetsDir = join(root, `${opts.distDir}/assets`);
  await mkdir(buildAssetsDir).catch(() => null);

  for (const pkgName of assets ?? []) {
    const pkgDir = dirname(require.resolve(`${pkgName}/package.json`));
    const assetsPkgDir = resolve(pkgDir, "assets");
    await cp(assetsPkgDir, buildAssetsDir, { recursive: true });
  }
}
