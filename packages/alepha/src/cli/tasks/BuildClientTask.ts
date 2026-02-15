import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/system";
import type { UserConfig } from "vite";
import { analyzer as viteAnalyzer } from "vite-bundle-analyzer";
import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Build client-side bundle with Vite.
 *
 * Compiles the browser/client code for production,
 * including code splitting and minification.
 * Analyze step stays in BuildCommand (ViteBuildProvider).
 * This task wraps only the actual Vite client build call.
 */
export class BuildClientTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly viteUtils = $inject(ViteUtils);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (!ctx.hasClient) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const stats = ctx.options.stats ?? false;
    const isCI = ctx.alepha.isCI();

    // Write index.html template for Vite to consume
    const template = this.viteUtils.generateIndexHtml(ctx.entry);
    const indexHtmlPath = this.fs.join(ctx.root, "index.html");
    await this.fs.writeFile(indexHtmlPath, template);

    try {
      await ctx.run({
        name: "vite build client",
        handler: async () => {
          await this.buildClient({
            dist: `${distDir}/${publicDir}`,
            stats,
            silent: !isCI,
          });
        },
      });
    } finally {
      await this.fs.rm(indexHtmlPath);
    }
  }

  protected async buildClient(opts: {
    dist: string;
    stats?: boolean;
    silent?: boolean;
  }): Promise<void> {
    const { build: viteBuild } = await this.viteUtils.importVite();
    const plugins: any[] = [];

    const viteReact = await this.viteUtils.importViteReact();
    if (viteReact) plugins.push(viteReact());

    plugins.push(this.viteUtils.createSsrPreloadPlugin());

    if (opts.stats) {
      plugins.push(
        viteAnalyzer({
          analyzerMode: "static",
        }),
      );
    }

    const logger = opts.silent
      ? this.viteUtils.createBufferedLogger()
      : undefined;

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
          },
        },
      },
      esbuild: { legalComments: "none", keepNames: true },
      customLogger: logger,
      plugins,
    };

    try {
      await viteBuild(viteBuildClientConfig);
    } catch (error) {
      logger?.flush();
      throw error;
    }
  }
}
