import type { Alepha } from "@alepha/core";

export * from "./plugins/viteAlepha.ts";
export * from "./plugins/viteAlephaBuild.ts";
export * from "./plugins/viteAlephaBuildVercel.ts";
export * from "./plugins/viteAlephaDev.ts";
export * from "./plugins/viteCompress.ts";

declare global {
  var __alepha: Alepha;
}

export { defineConfig } from "vite";

/**
 * Plugin vite for Alepha framework.
 *
 * This module provides Vite plugins and configurations to integrate Alepha applications with Vite's build and development processes.
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import { viteAlepha } from "@alepha/vite";
 *
 * export default defineConfig({
 *   plugins: [viteAlepha()],
 *   // other Vite configurations...
 * });
 * ```
 *
 * @module alepha.vite
 */
