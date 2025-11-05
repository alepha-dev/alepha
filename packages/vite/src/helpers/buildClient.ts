import type { UserConfig } from "vite";
import { analyzer as viteAnalyser } from "vite-bundle-analyzer";
import { type ViteCompressOptions, viteCompress } from "../viteCompress.ts";
import { importVite } from "./importVite.ts";

export interface BuildClientOptions {
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

export const buildClient = async (opts: BuildClientOptions) => {
  const { build: viteBuild, mergeConfig } = await importVite();
  const plugins: any[] = [];

  const compress: ViteCompressOptions | undefined = opts.precompress
    ? typeof opts.precompress === "object"
      ? opts.precompress
      : {}
    : undefined;

  if (opts.stats) {
    plugins.push(
      viteAnalyser({
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
};
