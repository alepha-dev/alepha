import type { UserConfig } from "vite";
import { analyzer as viteAnalyzer } from "vite-bundle-analyzer";
import { createBufferedLogger } from "../helpers/createBufferedLogger.ts";
import { importVite } from "../helpers/importVite.ts";
import { importViteReact } from "../helpers/importViteReact.ts";
import { viteAlephaSsrPreload } from "../plugins/viteAlephaSsrPreload.ts";
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
   * If true, generate build stats report.
   */
  stats?: boolean;

  /**
   * If true, suppress build output. Logs are buffered and only shown on failure.
   *
   * @default false
   */
  silent?: boolean;
}

/**
 * Build client-side bundle with Vite.
 *
 * This task compiles the browser/client code for production,
 * including code splitting, minification, and optional compression.
 */
export async function buildClient(opts: BuildClientOptions): Promise<void> {
  const { build: viteBuild } = await importVite();
  const plugins: any[] = [];

  const viteReact = await importViteReact();
  if (viteReact) plugins.push(viteReact());

  // Add preload plugin for SSR module preloading
  plugins.push(viteAlephaSsrPreload());

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

  // Create buffered logger for silent mode
  const logger = opts.silent ? createBufferedLogger() : undefined;

  const viteBuildClientConfig: UserConfig = {
    mode: "production",
    logLevel: opts.silent ? "silent" : undefined,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    publicDir: "public",
    build: {
      outDir: opts.dist,
      manifest: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          entryFileNames: "entry.[hash].js",
          chunkFileNames: "chunk.[hash].js",
          assetFileNames: "asset.[hash][extname]",
          // keepNames: true,
          // manualChunks: (id) => {
          //   // TODO: this is mandatory for now, rolldown create some cyclical deps with icons & jsx
          //   if (
          //     id.includes("@tabler/icons-react") ||
          //     id.includes("lucide-react")
          //   ) {
          //     return "icons";
          //   }
          //   if (id.includes("node_modules/react")) {
          //     return "react";
          //   }
          // },
        },
      },
    },
    esbuild: { legalComments: "none" },
    customLogger: logger,
    plugins,
  };

  try {
    await viteBuild(viteBuildClientConfig);
  } catch (error) {
    // Flush buffered logs on failure so user can see what happened
    logger?.flush();
    throw error;
  }
}
