import { writeFile } from "node:fs/promises";
import type { Alepha } from "alepha";

export interface GenerateSitemapOptions {
  /**
   * Alepha instance to use for generating the sitemap.
   */
  alepha: Alepha;

  /**
   * Base URL for the sitemap (e.g., "https://example.com").
   */
  baseUrl: string;

  /**
   * Output file path for the sitemap. If provided, writes the sitemap to disk.
   */
  output?: string;

  /**
   * Add Runner for logging (@see Alepha CLI)
   */
  run?: (opts: {
    name: string;
    handler: () => Promise<void>;
  }) => Promise<string>;
}

/**
 * Generate sitemap.xml from Alepha page primitives.
 *
 * Queries all page primitives and generates a sitemap.xml
 * containing URLs for all accessible pages.
 */
export async function generateSitemap(
  opts: GenerateSitemapOptions,
): Promise<string> {
  const pages = getSitemapPages(opts.alepha);

  // Nothing to generate
  if (pages.length === 0) {
    return "";
  }

  let result = "";

  const fn = async () => {
    result = generateSitemapFromPages(pages, opts.baseUrl);
    if (opts.output) {
      await writeFile(opts.output, result);
    }
  };

  if (opts.run) {
    await opts.run({
      name: "generate sitemap",
      handler: fn,
    });
  } else {
    await fn();
  }

  return result;
}

/**
 * Get all pages that should be included in the sitemap.
 */
function getSitemapPages(alepha: Alepha): any[] {
  const pages = alepha.primitives("page") as any[];
  return pages.filter((page) => {
    const options = page.options;
    // Skip pages with children (parent pages that can't be rendered directly)
    if (options.children) {
      return false;
    }
    // Include pages without parameters or static pages with entries
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

function generateSitemapFromPages(pages: any[], baseUrl: string): string {
  const urls: string[] = [];
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  for (const page of pages) {
    const options = page.options;

    if (!options.schema?.params) {
      // Simple page without parameters
      const path = options.path || "";
      const url = `${normalizedBaseUrl}${path === "" ? "/" : path}`;
      urls.push(url);
    } else if (
      options.static &&
      typeof options.static === "object" &&
      options.static.entries
    ) {
      // Static page with predefined entries
      for (const entry of options.static.entries) {
        const path = buildPathFromParams(
          options.path || "",
          entry.params || {},
        );
        const url = `${normalizedBaseUrl}${path}`;
        urls.push(url);
      }
    }
  }

  return buildSitemapXml(urls);
}

function buildPathFromParams(
  pathPattern: string,
  params: Record<string, any>,
): string {
  let path = pathPattern;

  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, String(value));
  }

  return path || "/";
}

function buildSitemapXml(urls: string[]): string {
  const lastMod = new Date().toISOString().split("T")[0];
  const urlEntries = urls
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeXml(url)}</loc>\n\t\t<lastmod>${lastMod}</lastmod>\n  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
