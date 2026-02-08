import { $hook, $inject, type Alepha, AlephaError } from "alepha";
import { importVite } from "alepha/vite";
import type { InlineConfig, ViteDevServer } from "vite";
import { FileSystemProvider } from "../../system/index.ts";
import type { AppEntry } from "../providers/AppEntryProvider.ts";

export class ViteUtils {
  protected readonly fs = $inject(FileSystemProvider);
  protected viteDevServer?: ViteDevServer;

  public generateIndexHtml(entry: AppEntry): string {
    const style = entry.style;
    const browser = entry.browser ?? entry.server;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>App</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
${style ? `<link rel="stylesheet" href="/${style}" />` : ""}
</head>
<body>
<div id="root"></div>
<script type="module" src="/${browser}"></script>
</body>
</html>
`.trim();
  }

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

  public importModule(path: string): Promise<any> {
    if (!this.viteDevServer) {
      throw new AlephaError("Vite dev server not initialized");
    }
    return this.viteDevServer.ssrLoadModule(path);
  }

  public async runAlepha(opts: {
    entry: AppEntry;
    mode: "production" | "development";
  }): Promise<Alepha> {
    const { createServer } = await importVite();

    process.env.NODE_ENV = opts.mode;
    process.env.ALEPHA_CLI_IMPORT = "true"; // signal Alepha App about CLI import, run(alepha) won't start server
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

    return alepha;
  }
}
