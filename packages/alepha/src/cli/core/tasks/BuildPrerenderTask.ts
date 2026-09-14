import { dirname } from "node:path";

import { $inject, AlephaError } from "alepha";
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
        // `configure` has to run before pages can be rendered; the same
        // emit is how BuildStaticTask and `gen openapi` boot the app.
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

    const filepath = `${dist}${this.fileName(state.url.pathname)}`;

    await this.fs.mkdir(dirname(filepath));
    await this.fs.writeFile(filepath, html);
  }

  /**
   * The file a prerendered page is written to, relative to the public
   * directory: `/` is `/index.html`, and every other path is its DECODED
   * pathname with `.html` appended.
   *
   * ## ⚠️ Decoded, because every host looks the file up decoded
   *
   * `state.url.pathname` is percent-encoded: `ReactPageProvider.compile` runs
   * each param through `encodeURIComponent`, so the `$sitemap` slug is
   * `/docs/reference-primitives-%24sitemap`. Written verbatim, that became a
   * file named `...-%24sitemap.html`, and no host ever found it:
   *
   * - Cloudflare's asset worker decodes each segment of the request path
   *   (`decodePath`) before the manifest lookup, so it looked for
   *   `...-$sitemap.html` and answered the 404 page. 75 reference pages of
   *   alepha.dev were 404s the sitemap advertised, and each one hydrated the
   *   real route over the 404 shell (React #418).
   * - Bay stats `r.URL.Path`, which Go has already decoded.
   *
   * Decoding segment by segment is Cloudflare's own rule, so a path that
   * round-trips through `encodeURIComponent` lands on the name all of them
   * read. A malformed escape is kept verbatim, as Cloudflare keeps it.
   *
   * @throws {AlephaError} when a decoded segment is `.` or `..`: `%2E%2E`
   * decodes to a directory traversal, and the file would be written outside
   * the public directory.
   */
  public fileName(pathname: string): string {
    if (pathname === "/") {
      return "/index.html";
    }
    const decoded = pathname
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/")
      .replace(/\/+/g, "/");
    if (decoded.split("/").some((it) => it === "." || it === "..")) {
      throw new AlephaError(
        `Cannot prerender "${pathname}": it decodes to "${decoded}", which leaves the public directory.`,
      );
    }
    return `${decoded}.html`;
  }
}
