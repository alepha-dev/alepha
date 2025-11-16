import { mkdir, writeFile } from "node:fs/promises";
import type { Alepha } from "alepha";
import { importAlepha } from "../helpers/importAlepha.ts";
import {
  compressFile,
  type ViteCompressOptions,
} from "../plugins/viteCompress.ts";

export interface PrerenderOptions {
  template: string; // template HTML file to use for pre-rendering
  entry: string; // entry point for the Alepha application
  dist: string; // client dist directory
  compress?: ViteCompressOptions | boolean; // optional compression options
}

/**
 * Pre-renders static pages defined in the Alepha application.
 * Allow SSG for AlephaReact module.
 */
export async function prerender(opts: PrerenderOptions) {
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
    `[plugin prerender] Rendered ${stats.count} page${stats.count > 1 ? "s" : ""} in ${Date.now() - now}ms.`,
  );
}

async function prerenderFromAlepha(
  alepha: Alepha,
  dist: string,
  compress?: ViteCompressOptions | boolean,
): Promise<{ count: number }> {
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
