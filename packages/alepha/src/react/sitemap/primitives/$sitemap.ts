import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { type ServerRequest, ServerRouterProvider } from "alepha/server";

/**
 * Expose a `sitemap.xml` generated from the application's `$page` primitives.
 *
 * Registers a `GET /sitemap.xml` route that reads every registered page at
 * request time and emits a standard XML sitemap. Marked `static` by default, so
 * the build prerenders it to `dist/public/sitemap.xml` for static deployments -
 * while SSR runtimes also serve it live.
 *
 * The hostname comes from `options.hostname`, falling back to `PUBLIC_URL`, then
 * to `""` (relative URLs).
 *
 * @example
 * ```ts
 * import { $sitemap } from "alepha/react/sitemap";
 *
 * class AppRouter {
 *   sitemap = $sitemap();
 * }
 * ```
 */
export const $sitemap = (
  options: SitemapPrimitiveOptions = {},
): SitemapPrimitive => {
  return createPrimitive(SitemapPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface SitemapPrimitiveOptions {
  /**
   * Absolute base URL used to build `<loc>` entries (e.g. "https://alepha.dev").
   *
   * Defaults to `PUBLIC_URL`, then to `""` (relative URLs).
   */
  hostname?: string;

  /**
   * Route path the sitemap is served at.
   *
   * @default "/sitemap.xml"
   */
  path?: string;

  /**
   * Prerender the sitemap to a static file at build time.
   *
   * @default true
   */
  static?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class SitemapPrimitive extends Primitive<SitemapPrimitiveOptions> {
  protected readonly router = $inject(ServerRouterProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected onInit() {
    this.router.createRoute({
      method: "GET",
      path: this.options.path ?? "/sitemap.xml",
      static: this.options.static ?? true,
      silent: true,
      handler: (request: ServerRequest) => {
        request.reply.setHeader("content-type", "application/xml");
        return this.buildSitemap();
      },
    });
  }

  /**
   * Render the sitemap to its path and body. Used by the build to snapshot the
   * sitemap to a static file.
   */
  public prerender(): { path: string; body: string } {
    return {
      path: this.options.path ?? "/sitemap.xml",
      body: this.buildSitemap(),
    };
  }

  /**
   * Build the sitemap XML from the application's page primitives.
   */
  protected buildSitemap(): string {
    const hostname =
      this.options.hostname ?? String(this.alepha.env.PUBLIC_URL ?? "");
    const pages = this.getSitemapPages();
    return this.generateSitemapFromPages(pages, hostname);
  }

  /**
   * Select the pages that should appear in the sitemap.
   *
   * Excludes layout pages (with `children`), wildcard paths, and `/404`.
   * Parameterized pages are included only when they declare `static.entries`.
   */
  protected getSitemapPages(): any[] {
    const pages = this.alepha.primitives("page") as any[];
    return pages.filter((page) => {
      const options = page.options;
      const path: string = options.path ?? "";
      if (options.children) {
        return false;
      }
      if (path.includes("*")) {
        return false;
      }
      if (path === "/404") {
        return false;
      }
      if (!options.schema?.params) {
        return true;
      }
      if (
        options.static &&
        typeof options.static === "object" &&
        options.static.entries
      ) {
        return true;
      }
      return false;
    });
  }

  protected generateSitemapFromPages(pages: any[], baseUrl: string): string {
    const urls: string[] = [];
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    for (const page of pages) {
      const options = page.options;

      if (!options.schema?.params) {
        const path = options.path || "";
        const url = `${normalizedBaseUrl}${path === "" ? "/" : path}`;
        urls.push(url);
      } else if (
        options.static &&
        typeof options.static === "object" &&
        options.static.entries
      ) {
        for (const entry of options.static.entries) {
          const path = this.buildPathFromParams(
            options.path || "",
            entry.params || {},
          );
          const url = `${normalizedBaseUrl}${path}`;
          urls.push(url);
        }
      }
    }

    return this.buildSitemapXml(urls);
  }

  /**
   * Same substitution rules as `ReactPageProvider.compile` — whole-token
   * match, `$&` kept literal, values percent-encoded. A sitemap `<loc>` has to
   * be a valid URL, and a slug with a space or a slash produced neither.
   */
  protected buildPathFromParams(
    pathPattern: string,
    params: Record<string, any>,
  ): string {
    const path = pathPattern.replace(/:([A-Za-z0-9_]+)/g, (match, key) =>
      Object.hasOwn(params, key)
        ? encodeURIComponent(String(params[key]))
        : match,
    );
    return path || "/";
  }

  protected buildSitemapXml(urls: string[]): string {
    const lastMod = this.dateTime.now().format("YYYY-MM-DD");
    const urlEntries = urls
      .map(
        (url) =>
          `  <url>\n    <loc>${this.escapeXml(url)}</loc>\n    <lastmod>${lastMod}</lastmod>\n  </url>`,
      )
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
  }

  protected escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

$sitemap[KIND] = SitemapPrimitive;
