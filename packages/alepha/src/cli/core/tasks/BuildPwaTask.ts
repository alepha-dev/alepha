import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Generate PWA web app manifest.
 *
 * Produces a `manifest.webmanifest` in the public output directory
 * from the `pwa` section of build options. Detects icons from `public/`.
 */
export class BuildPwaTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt) {
      return;
    }
    const pwa = ctx.options.pwa;
    if (!pwa || !ctx.hasClient) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const outputDir = this.fs.join(ctx.root, distDir, publicDir);

    await ctx.run({
      name: "generate pwa manifest",
      handler: async () => {
        const icons = await this.detectIcons(outputDir);

        const manifest: Record<string, unknown> = {
          name: pwa.name,
          short_name: pwa.shortName ?? pwa.name,
          start_url: "/",
          display: pwa.display ?? "standalone",
          theme_color: pwa.themeColor ?? "#ffffff",
          background_color: pwa.backgroundColor ?? "#ffffff",
        };

        if (icons.length > 0) {
          manifest.icons = icons;
        }

        const output = this.fs.join(outputDir, "manifest.webmanifest");
        await this.fs.writeFile(output, JSON.stringify(manifest, null, 2));
      },
    });
  }

  /**
   * Detect icon files in the public output directory.
   *
   * Looks for common icon filenames and generates
   * manifest icon entries with appropriate sizes and types.
   */
  protected async detectIcons(
    publicDir: string,
  ): Promise<Array<{ src: string; sizes: string; type: string }>> {
    const icons: Array<{ src: string; sizes: string; type: string }> = [];

    const candidates: Array<{
      file: string;
      sizes: string;
      type: string;
    }> = [
      { file: "icon-192.png", sizes: "192x192", type: "image/png" },
      { file: "icon-512.png", sizes: "512x512", type: "image/png" },
      { file: "icon.svg", sizes: "any", type: "image/svg+xml" },
    ];

    for (const candidate of candidates) {
      if (await this.fs.exists(this.fs.join(publicDir, candidate.file))) {
        icons.push({
          src: `/${candidate.file}`,
          sizes: candidate.sizes,
          type: candidate.type,
        });
      }
    }

    return icons;
  }
}
