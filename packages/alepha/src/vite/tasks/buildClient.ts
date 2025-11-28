import type { UserConfig } from "vite";
import { analyzer as viteAnalyzer } from "vite-bundle-analyzer";
import { importVite } from "../helpers/importVite.ts";
import {
  type ViteCompressOptions,
  viteCompress,
} from "../plugins/viteCompress.ts";

export interface BuildClientOptions {
  /**
   * Output directory for client build.
   */
  dist: string;

  /**
   * If true, precompress assets using gzip and brotli compression.
   *
   * @default false
   */
  precompress?: ViteCompressOptions | boolean;

  /**
   * If true, prerender all static routes found in the $pages directory.
   *
   * @default false
   */
  prerender?: boolean;

  /**
   * Build a sitemap.xml file based on the $pages routes.
   */
  sitemap?: {
    hostname: string;
  };

  /**
   * Override Vite config options.
   */
  config?: UserConfig;

  /**
   * If true, generate build stats report.
   */
  stats?: boolean;
}

/**
 * Build client-side bundle with Vite.
 *
 * This task compiles the browser/client code for production,
 * including code splitting, minification, and optional compression.
 */
export async function buildClient(opts: BuildClientOptions): Promise<void> {
  const { build: viteBuild, mergeConfig } = await importVite();
  const plugins: any[] = [];

  const compress: ViteCompressOptions | undefined = opts.precompress
    ? typeof opts.precompress === "object"
      ? opts.precompress
      : {}
    : undefined;

  if (opts.stats) {
    plugins.push(
      viteAnalyzer({
        analyzerMode: "static",
      }),
    );
  }

  if (opts.precompress && compress) {
    plugins.push(viteCompress(compress));
  }

  const viteBuildClientConfig: UserConfig = {
    mode: "production",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    publicDir: "public",
    build: {
      chunkSizeWarningLimit: 1000,
      outDir: opts.dist,
      rollupOptions: {
        output: {
          entryFileNames: "entry.[hash].js",
          chunkFileNames: "chunk.[hash].js",
          assetFileNames: "asset.[hash][extname]",
        },
      },
    },
    esbuild: { legalComments: "none" },
    plugins,
  };

  await viteBuild(mergeConfig(viteBuildClientConfig, opts.config ?? {}));
}
