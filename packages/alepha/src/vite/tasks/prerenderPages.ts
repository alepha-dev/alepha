import { mkdir, writeFile } from "node:fs/promises";
import type { Alepha } from "alepha";
import { importAlepha } from "../helpers/importAlepha.ts";
import {
  compressFile,
  type ViteCompressOptions,
} from "../plugins/viteCompress.ts";

export interface PrerenderPagesOptions {
  /**
   * HTML template to use for pre-rendering.
   */
  template: string;

  /**
   * Entry point for the built Alepha application.
   */
  entry: string;

  /**
   * Client dist directory for output files.
   */
  dist: string;

  /**
   * Optional compression options.
   */
  compress?: ViteCompressOptions | boolean;
}

export interface PrerenderPagesResult {
  /**
   * Number of pages pre-rendered.
   */
  count: number;
}

/**
 * Pre-render static pages defined in the Alepha application.
 *
 * This task loads the built Alepha application, queries all page
 * descriptors with `static: true`, and generates static HTML files
 * for each page. Supports pages with parameterized routes via
 * `static.entries` configuration.
 */
export async function prerenderPages(
  opts: PrerenderPagesOptions,
): Promise<PrerenderPagesResult> {
  const alepha = await importAlepha(opts.entry, {
    env: {
      REACT_SERVER_TEMPLATE: opts.template,
    },
  });

  const now = Date.now();

  if (!alepha.isConfigured()) {
    await alepha.events.emit("configure", alepha);
    (alepha as any).configured = true;
  }

  const stats = await prerenderFromAlepha(alepha, opts.dist, opts.compress);

  console.log(
    `[prerenderPages] Rendered ${stats.count} page${stats.count > 1 ? "s" : ""} in ${Date.now() - now}ms.`,
  );

  return stats;
}

async function prerenderFromAlepha(
  alepha: Alepha,
  dist: string,
  compress?: ViteCompressOptions | boolean,
): Promise<PrerenderPagesResult> {
  let count = 0;
  const pages = alepha.descriptors("page") as any[];

  for (const page of pages) {
    const options = page.options;

    if (options.children) {
      continue;
    }

    if (!options.static) {
      continue;
    }

    const config = typeof options.static === "object" ? options.static : {};

    if (!options.schema?.params) {
      count += 1;
      await renderFile(page, {}, dist, compress);
      continue;
    }

    if (config.entries) {
      for (const entry of config.entries) {
        count += 1;
        await renderFile(page, entry, dist, compress);
      }
    }
  }

  return { count };
}

async function renderFile(
  page: any,
  options: any,
  dist: string,
  compress?: ViteCompressOptions | boolean,
) {
  const { html, state } = await page.render({
    html: true,
    ...options,
  });

  const pathname = state.url.pathname;
  const filepath = `${dist}${pathname === "/" ? "/index" : pathname}.html`;

  await mkdir(filepath.substring(0, filepath.lastIndexOf("/")), {
    recursive: true,
  });

  await writeFile(filepath, html);

  if (compress) {
    await compressFile(typeof compress === "object" ? compress : {}, filepath);
  }
}
