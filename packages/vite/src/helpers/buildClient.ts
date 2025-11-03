import type { UserConfig } from "vite";
import { type ViteCompressOptions, viteCompress } from "../viteCompress.ts";
import { importVite } from "./importVite.ts";

export interface BuildClientOptions {
  dist: string;
  html: string;

  /**
   * @default false
   */
  precompress?: ViteCompressOptions | boolean;

  /**
   * @default false
   */
  prerender?: boolean;

  /**
   * Build a sitemap.xml file based on the $pages routes.
   */
  sitemap?: {
    hostname: string;
  };

  config?: UserConfig;
}

export const buildClient = async (opts: BuildClientOptions) => {
  const { build: viteBuild, mergeConfig } = await importVite();
  const plugins: any[] = [];

  const compress: ViteCompressOptions | undefined = opts.precompress
    ? typeof opts.precompress === "object"
      ? opts.precompress
      : {}
    : undefined;

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
