import { dirname } from "node:path";
import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Pre-render static pages defined in the Alepha application.
 *
 * Queries all page primitives with `static: true` and generates
 * static HTML files for each page. Supports pages with parameterized
 * routes via `static.entries` configuration.
 */
export class BuildPrerenderTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt) {
      return;
    }
    if (!ctx.hasClient) {
      return;
    }

    const pages = this.getStaticPages(ctx);
    if (pages.length === 0) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const dist = this.fs.join(ctx.root, distDir, publicDir);

    await ctx.run({
      name: "pre-render pages",
      handler: async () => {
        // TODO: running configure here is a temporary workaround
        if (!ctx.alepha.isConfigured()) {
          await ctx.alepha.events.emit("configure", ctx.alepha);
        }
        await this.prerenderFromAlepha(pages, dist);
      },
    });
  }

  protected getStaticPages(ctx: BuildTaskContext): any[] {
    const pages = ctx.alepha.primitives("page") as any[];
    return pages.filter((page) => {
      const options = page.options;
      return options.static && !options.children;
    });
  }

  protected async prerenderFromAlepha(
    pages: any[],
    dist: string,
  ): Promise<number> {
    let count = 0;

    for (const page of pages) {
      const options = page.options;
      const config = typeof options.static === "object" ? options.static : {};

      if (!options.schema?.params) {
        count += 1;
        await this.renderFile(page, {}, dist);
        continue;
      }

      if (config.entries) {
        for (const entry of config.entries) {
          count += 1;
          await this.renderFile(page, entry, dist);
        }
      }
    }

    return count;
  }

  protected async renderFile(
    page: any,
    options: any,
    dist: string,
  ): Promise<void> {
    const { html, state } = await page.render({
      html: true,
      ...options,
    });

    const pathname = state.url.pathname;
    const filepath = `${dist}${pathname === "/" ? "/index" : pathname}.html`;

    await this.fs.mkdir(dirname(filepath));
    await this.fs.writeFile(filepath, html);
  }
}
