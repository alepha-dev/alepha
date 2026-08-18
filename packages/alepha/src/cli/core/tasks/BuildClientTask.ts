import { $inject, Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";
import type { UserConfig } from "vite";
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
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly viteUtils = $inject(ViteUtils);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt) {
      return;
    }
    if (!ctx.hasClient) {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const stats = ctx.options.stats ?? false;
    const isCI = this.alepha.isCI();

    // Write index.html template for Vite to consume
    const template = this.viteUtils.generateIndexHtml(ctx.entry, {
      pwa: !!ctx.options.pwa,
    });
    await this.fs.mkdir(this.fs.join(ctx.root, "node_modules/.alepha"));
    const indexHtmlPath = this.fs.join(
      ctx.root,
      "node_modules/.alepha/index.html",
    );
    await this.fs.writeFile(indexHtmlPath, template);

    try {
      await ctx.run({
        name: "build client",
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
    stats?: boolean | "json";
    silent?: boolean;
  }): Promise<void> {
    const { build: viteBuild } = await this.viteUtils.importVite();
    const plugins: any[] = [];

    const viteReact = await this.viteUtils.importViteReact();
    if (viteReact) plugins.push(viteReact());

    plugins.push(this.viteUtils.createTsconfigPathsPlugin());
    plugins.push(this.viteUtils.createSsrPreloadPlugin());

    if (opts.stats) {
      const viteAnalyzer = await this.viteUtils.importAnalyzer();
      plugins.push(
        viteAnalyzer({
          analyzerMode: opts.stats === "json" ? "json" : "static",
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
      resolve: {
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
      },
      // Deliberately NOT set here. Vite's own `build()` auto-loads the app's
      // vite.config.ts and merges it under this inline config — an inline
      // scalar wins over the loaded file on the same key, so hardcoding
      // `publicDir: "public"` used to silently discard an app-configured
      // `publicDir` (e.g. a monorepo app whose static assets live in a
      // sibling package) on every build. Leaving the key unset lets the
      // app's own config supply it, and Vite's built-in "public" default
      // apply only when the app never configured one.
      build: {
        outDir: opts.dist,
        manifest: true,
        chunkSizeWarningLimit: 1000,
        rolldownOptions: {
          input: "node_modules/.alepha/index.html",
          output: {
            entryFileNames: "entry.[hash].js",
            chunkFileNames: "chunk.[hash].js",
            assetFileNames: "asset.[hash][extname]",
          },
        },
      },
      customLogger: logger,
      plugins,
    };

    try {
      await viteBuild(viteBuildClientConfig);
      await this.postBuildCleanUpForIndexHtml(opts.dist);
    } catch (error) {
      logger?.flush();
      throw error;
    }
  }

  /**
   * Weird cleanup required because we changed input from "index.html" to "node_modules/.alepha/index.html".
   *
   * `dist` is required on purpose: it must be the same directory Vite built
   * into (`output.dist`/`output.public`). A default here silently pointed the
   * cleanup at another tree whenever the app customised its output.
   */
  public async postBuildCleanUpForIndexHtml(dist: string) {
    const manifestPath = `${dist}/.vite/manifest.json`;
    let text = await this.fs.readTextFile(manifestPath);
    text = text.replaceAll("node_modules/.alepha/index.html", "index.html");
    await this.fs.writeFile(manifestPath, text);
    await this.fs.cp(
      `${dist}/node_modules/.alepha/index.html`,
      `${dist}/index.html`,
    );
    await this.fs.rm(`${dist}/node_modules`, { recursive: true });
  }
}
