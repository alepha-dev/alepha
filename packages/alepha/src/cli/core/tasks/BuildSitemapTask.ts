import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Generate sitemap.xml from Alepha page primitives.
 *
 * Queries all page primitives and generates a sitemap.xml
 * containing URLs for all accessible pages.
 */
export class BuildSitemapTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  async run(ctx: BuildTaskContext): Promise<void> {
    const hostname = ctx.options.sitemap?.hostname;
    if (!hostname) {
      return;
    }

    const pages = this.getSitemapPages(ctx);
    if (pages.length === 0) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const output = this.fs.join(ctx.root, distDir, publicDir, "sitemap.xml");

    await ctx.run({
      name: "generate sitemap",
      handler: async () => {
        const xml = this.generateSitemapFromPages(pages, hostname);
        await this.fs.writeFile(output, xml);
      },
    });
  }

  protected getSitemapPages(ctx: BuildTaskContext): any[] {
    const pages = ctx.alepha.primitives("page") as any[];
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

  protected buildPathFromParams(
    pathPattern: string,
    params: Record<string, any>,
  ): string {
    let path = pathPattern;
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, String(value));
    }
    return path || "/";
  }

  protected buildSitemapXml(urls: string[]): string {
    const lastMod = new Date().toISOString().split("T")[0];
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
