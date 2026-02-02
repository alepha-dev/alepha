import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Alepha } from "alepha";
import {
  compressFile,
  type ViteCompressOptions,
} from "../plugins/viteCompress.ts";

export interface PrerenderPagesOptions {
  /**
   * Alepha instance to use for pre-rendering.
   */
  alepha: Alepha;

  /**
   * Client dist directory for output files.
   */
  dist: string;

  /**
   * Optional compression options.
   */
  compress?: ViteCompressOptions | boolean;

  /**
   * Add Runner for logging (@see Alepha CLI)
   */
  run?: (opts: {
    name: string;
    handler: () => Promise<void>;
  }) => Promise<string>;
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
 * Queries all page primitives with `static: true` and generates
 * static HTML files for each page. Supports pages with parameterized
 * routes via `static.entries` configuration.
 */
export async function prerenderPages(
  opts: PrerenderPagesOptions,
): Promise<PrerenderPagesResult> {
  const alepha = opts.alepha;
  const pages = getStaticPages(alepha);

  // Nothing to pre-render
  if (pages.length === 0) {
    return { count: 0 };
  }

  let result: PrerenderPagesResult = { count: 0 };

  const fn = async () => {
    // TODO: running configure here is a temporary workaround
    if (!alepha.isConfigured()) {
      await alepha.events.emit("configure", alepha);
    }
    result = await prerenderFromAlepha(pages, opts.dist, opts.compress);
  };

  if (opts.run) {
    await opts.run({
      name: "pre-render pages",
      handler: fn,
    });
  } else {
    await fn();
  }

  return result;
}

/**
 * Get all static pages from the Alepha instance.
 */
function getStaticPages(alepha: Alepha): any[] {
  const pages = alepha.primitives("page") as any[];
  return pages.filter((page) => {
    const options = page.options;
    return options.static && !options.children;
  });
}

async function prerenderFromAlepha(
  pages: any[],
  dist: string,
  compress?: ViteCompressOptions | boolean,
): Promise<PrerenderPagesResult> {
  let count = 0;

  for (const page of pages) {
    const options = page.options;
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

  await mkdir(dirname(filepath), {
    recursive: true,
  });

  await writeFile(filepath, html);

  if (compress) {
    await compressFile(typeof compress === "object" ? compress : {}, filepath);
  }
}
