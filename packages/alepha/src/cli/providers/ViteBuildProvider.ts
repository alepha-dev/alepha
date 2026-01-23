import { $hook, $inject, type Alepha, AlephaError } from "alepha";
import { importVite } from "alepha/vite";
import type { InlineConfig, ViteDevServer } from "vite";
import type { AppEntry } from "./AppEntryProvider.ts";
import { ViteTemplateProvider } from "./ViteTemplateProvider.ts";

export class ViteBuildProvider {
  protected alepha?: Alepha;
  protected appEntry?: AppEntry;
  protected viteDevServer?: ViteDevServer;
  protected readonly templateProvider = $inject(ViteTemplateProvider);

  /**
   * We need to close the Vite dev server after build is done.
   */
  protected onReady = $hook({
    on: "ready",
    priority: "last",
    handler: async () => {
      await this.viteDevServer?.close();
    },
  });
  protected onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.viteDevServer?.close();
    },
  });

  public async init(opts: { entry: AppEntry }) {
    const { createServer } = await importVite();

    process.env.ALEPHA_CLI_IMPORT = "true"; // signal Alepha App about CLI import, run(alepha) won't start server
    process.env.NODE_ENV = "production"; // force Alepha App in production mode for getting "production" metadata
    process.env.LOG_LEVEL ??= "warn"; // reduce log noise

    /**
     * 01/26 Vite 7
     * "runnerImport" doesn't work as expected here. (e.g. build docs fail)
     * -> We still use devServer and ssrLoadModule for now.
     * -> This is clearly a bad stuff, we need to find better way.
     */
    this.viteDevServer = await createServer({
      server: { middlewareMode: true },
      appType: "custom",
      logLevel: "silent",
    } satisfies InlineConfig);

    await this.viteDevServer.ssrLoadModule(opts.entry.server);

    const alepha: Alepha = (globalThis as any).__alepha;
    if (!alepha) {
      throw new AlephaError(
        "Alepha instance not found after loading entry module",
      );
    }

    this.alepha = alepha;
    this.appEntry = opts.entry;

    return alepha;
  }

  public hasClient(): boolean {
    if (!this.alepha) {
      throw new AlephaError("ViteBuildProvider not initialized");
    }
    try {
      this.alepha.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }

  public generateIndexHtml(): string {
    if (!this.appEntry) {
      throw new AlephaError("ViteBuildProvider not initialized");
    }
    return this.templateProvider.generateIndexHtml(this.appEntry);
  }
}
