import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { importAlepha } from "./importAlepha.ts";

export interface CopyAssetsOptions {
  entry: string; // entry point for the Alepha application
  distDir: string; // output directory for copied assets
}

export const copyAssets = async (opts: CopyAssetsOptions): Promise<void> => {
  const root = process.cwd();
  const alepha = await importAlepha(opts.entry);
  const assets = alepha.state.get("assets");
  if (!assets || assets.length === 0) {
    return;
  }

  const require = createRequire(join(root, opts.entry));
  const buildAssetsDir = join(root, `${opts.distDir}/assets`);
  console.log("processing assets to", buildAssetsDir);
  await mkdir(buildAssetsDir).catch(() => null);

  for (const pkgName of assets ?? []) {
    const pkgDir = dirname(require.resolve(`${pkgName}/package.json`));
    const assetsPkgDir = resolve(pkgDir, "assets");
    console.log("copying assets from", assetsPkgDir, "to", buildAssetsDir);
    await cp(assetsPkgDir, buildAssetsDir, { recursive: true });
  }
};
