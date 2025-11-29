import type { Alepha } from "alepha";

// Vite re-exports
export { defineConfig } from "vite";
// Helpers (for advanced use)
export * from "./helpers/boot.ts";
export * from "./helpers/createBufferedLogger.ts";
// Plugins (public API)
export * from "./plugins/viteAlepha.ts";
export * from "./plugins/viteAlephaBuild.ts";
export * from "./plugins/viteAlephaDev.ts";
export * from "./plugins/viteCompress.ts";
// Tasks (for CLI integration)
export * from "./tasks/index.ts";

declare global {
  var __cli_alepha: Alepha;
}

/**
 * Plugin vite for Alepha framework.
 *
 * This module provides Vite plugins and configurations to integrate Alepha applications with Vite's build and development processes.
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import { viteAlepha } from "alepha/vite";
 *
 * export default defineConfig({
 *   plugins: [viteAlepha()],
 *   // other Vite configurations...
 * });
 * ```
 *
 * @module alepha.vite
 */
