import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Copy assets from Alepha packages to the build output directory.
 *
 * Reads `alepha.build.assets` state to find packages with assets,
 * and copies their `/assets` directories to the build output.
 * Used by modules like AlephaServerSwagger to distribute UI files.
 */
export class BuildAssetsTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt) {
      return;
    }
    const assets = ctx.alepha.store.get("alepha.build.assets");

    if (!assets || assets.length === 0) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const entry = `${distDir}/index.js`;

    await ctx.run({
      name: "copy assets",
      handler: async () => {
        const require = createRequire(this.fs.join(ctx.root, entry));
        const buildAssetsDir = this.fs.join(ctx.root, distDir, "assets");
        await this.fs.mkdir(buildAssetsDir);

        for (const pkgName of assets ?? []) {
          const pkgDir = dirname(require.resolve(`${pkgName}/package.json`));
          const assetsPkgDir = resolve(pkgDir, "assets");
          await this.fs.cp(assetsPkgDir, buildAssetsDir);
        }
      },
    });
  }
}
