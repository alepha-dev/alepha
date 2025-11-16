import type { Alepha } from "alepha";
import { importAlepha } from "../helpers/importAlepha.ts";

export interface SitemapOptions {
  entry: string; // entry point for the Alepha application
  baseUrl: string; // base URL for the sitemap (e.g., "https://example.com")
  template?: string; // optional template HTML file
}

/**
 * Generate static sitemap XML from Alepha application.
 */
export async function generateSitemap(opts: SitemapOptions): Promise<string> {
  const alepha = await importAlepha(opts.entry, {
    env: opts.template
      ? {
          REACT_SERVER_TEMPLATE: opts.template,
        }
      : {},
  });

  if (!alepha.isConfigured()) {
    await alepha.events.emit("configure", alepha);
    (alepha as any).configured = true;
  }

  return generateSitemapFromAlepha(alepha, opts.baseUrl);
}

function generateSitemapFromAlepha(alepha: Alepha, baseUrl: string): string {
  const pages = alepha.descriptors("page") as any[];
  const urls: string[] = [];

  for (const page of pages) {
    const options = page.options;

    // Skip pages with children (parent pages that can't be rendered directly)
    if (options.children) {
      continue;
    }

    // Only include static pages or pages without parameters
    if (!options.schema?.params) {
      // Simple page without parameters
      const path = options.path || "";
      const url = `${baseUrl.replace(/\/$/, "")}${path === "" ? "/" : path}`;
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
        const url = `${baseUrl.replace(/\/$/, "")}${path}`;
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
