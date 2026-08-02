import { dirname } from "node:path";
import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Pre-render static pages and routes defined in the Alepha application.
 *
 * Two passes, both writing into `dist/public`:
 * - **pages** — every `$page` with `static: true` is rendered to an HTML file
 *   (supports parameterized routes via `static.entries`).
 * - **routes** — every `static` route primitive (a `$route({ static: true })`
 *   or a `$sitemap`) is invoked in-process and its body written verbatim to
 *   `{path}` (e.g. `sitemap.xml`, `robots.txt`).
 *
 * Both passes read the primitive registry and call a method on the already
 * created primitive instances — no provider is re-injected, so this works in
 * the build's configured-but-not-started container.
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
    const routes = this.getStaticRoutePrimitives(ctx);
    if (pages.length === 0 && routes.length === 0) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const dist = this.fs.join(ctx.root, distDir, publicDir);

    await ctx.run({
      name: "pre-render",
      handler: async () => {
        // TODO: running configure here is a temporary workaround
        if (!ctx.alepha.isConfigured()) {
          await ctx.alepha.events.emit("configure", ctx.alepha);
        }
        if (pages.length > 0) {
          await this.prerenderFromAlepha(pages, dist);
        }
        if (routes.length > 0) {
          await this.prerenderRoutes(routes, dist);
        }
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

  /**
   * Infer route primitives to snapshot: `$route({ static: true })` and every
   * `$sitemap`. Both expose an async `prerender(): { path, body }`.
   */
  protected getStaticRoutePrimitives(ctx: BuildTaskContext): any[] {
    const routes = (ctx.alepha.primitives("route") as any[]).filter(
      (route) => route.options?.static === true,
    );
    const sitemaps = ctx.alepha.primitives("sitemap") as any[];
    return [...routes, ...sitemaps];
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

  protected async prerenderRoutes(
    primitives: any[],
    dist: string,
  ): Promise<void> {
    for (const primitive of primitives) {
      const { path, body } = await primitive.prerender();
      const filepath = this.fs.join(dist, path);
      await this.fs.mkdir(dirname(filepath));
      await this.fs.writeFile(filepath, body);
    }
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
