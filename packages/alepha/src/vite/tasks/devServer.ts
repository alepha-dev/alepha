import type { InlineConfig } from "vite";
import { importVite } from "../helpers/importVite.ts";
import { importViteReact } from "../helpers/importViteReact.ts";
import { viteAlephaDev } from "../plugins/viteAlephaDev.ts";
import { viteAlephaSsrPreload } from "../plugins/viteAlephaSsrPreload.ts";

export interface DevServerOptions {
  /**
   * Path to the server entry file.
   * If not provided, will auto-detect.
   */
  entry?: string;

  /**
   * Port to run the dev server on.
   */
  port?: number;

  /**
   * Host to bind the dev server to.
   */
  host?: string | boolean;

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

/**
 * Start Vite development server with Alepha plugins.
 *
 * This task starts the Vite dev server with all required plugins:
 * - @vitejs/plugin-react (JSX/TSX compilation)
 * - viteAlephaDev (Alepha server integration)
 * - viteAlephaSsrPreload (SSR module preloading)
 */
export async function devServer(opts: DevServerOptions = {}): Promise<void> {
  const { createServer, mergeConfig } = await importVite();
  const plugins: any[] = [];

  // Add React plugin for JSX/TSX compilation
  const viteReact = await importViteReact();
  if (viteReact) plugins.push(viteReact());

  // Add SSR preload plugin
  plugins.push(viteAlephaSsrPreload());

  // Add Alepha dev plugin
  plugins.push(
    await viteAlephaDev({
      serverEntry: opts.entry,
      debug: opts.debug,
    }),
  );

  const config: InlineConfig = {
    plugins,
    server: {
      port: opts.port,
      host: opts.host,
    },
  };

  const server = await createServer(mergeConfig(config, {}));
  await server.listen();

  // server.printUrls();
}
