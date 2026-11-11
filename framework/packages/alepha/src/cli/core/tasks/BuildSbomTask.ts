import { $inject } from "alepha";
import { $logger } from "alepha/logger";

import { MetaResolver } from "../services/MetaResolver.ts";
import { SbomBuilder } from "../services/SbomBuilder.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Write `dist/sbom.cdx.json` when `build.sbom` is on: what the client build
 * and every server slice bundled, as {@link SbomBuilder} collected it.
 *
 * Runs after the server slices, which write `dist/package.json` (whose
 * externals the document lists), and needs nothing that runs later. A
 * prebuilt run linked nothing, so it has no graph to describe and leaves the
 * earlier build's file where it is.
 */
export class BuildSbomTask extends BuildTask {
  protected readonly sbom = $inject(SbomBuilder);
  protected readonly meta = $inject(MetaResolver);
  protected readonly log = $logger();

  async run(ctx: BuildTaskContext): Promise<void> {
    if (!ctx.options.sbom || ctx.flags?.prebuilt) {
      return;
    }
    await ctx.run({
      name: "write sbom",
      handler: async () => {
        const file = await this.sbom.write({
          root: ctx.root,
          distDir: ctx.options.output?.dist ?? "dist",
          // The manifest's `project`, so the SBOM and the artifact it
          // describes name the app the same way.
          project: this.meta.slug(ctx.root),
          version: ctx.meta?.version ?? "latest",
        });
        this.log.debug("SBOM written", { file });
      },
    });
  }
}
