import type { Alepha } from "alepha";

// Helpers (for advanced use)
export * from "./helpers/boot.ts";
export * from "./helpers/createBufferedLogger.ts";
// Plugins (public API)
export * from "./plugins/viteAlephaDev.ts";
export * from "./plugins/viteAlephaSsrPreload.ts";
export * from "./plugins/viteCompress.ts";
// Tasks (for CLI integration)
export * from "./tasks/index.ts";

declare global {
  var __cli_alepha: Alepha;
}

/**
 * Vite plugins and tasks for Alepha framework.
 *
 * This module provides Vite plugins and configurations to integrate Alepha applications with Vite's build and development processes.
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import { viteAlephaDev } from "alepha/vite";
 *
 * export default defineConfig({
 *   plugins: [viteAlephaDev()],
 *   // other Vite configurations...
 * });
 * ```
 *
 * @module alepha.vite
 */
