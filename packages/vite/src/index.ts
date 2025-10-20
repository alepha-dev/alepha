import type { Alepha } from "@alepha/core";

export * from "./viteAlepha.ts";
export * from "./viteAlephaBuild.ts";
export * from "./viteAlephaBuildVercel.ts";
export * from "./viteAlephaDev.ts";
export * from "./viteCompress.ts";

declare global {
  var __alepha: Alepha;
}

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
