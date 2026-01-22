/**
 * Build tasks for Alepha applications.
 *
 * These tasks can be used by:
 * - Vite plugins (viteAlephaDev, viteAlephaSsrPreload)
 * - CLI commands (alepha build, alepha dev)
 *
 * Each task is a standalone async function with explicit inputs and outputs.
 *
 * @module alepha.vite.tasks
 */

export * from "./buildClient.ts";
export * from "./buildServer.ts";
export * from "./copyAssets.ts";
export * from "./generateCloudflare.ts";
export * from "./generateDocker.ts";
export * from "./generateExternals.ts";
export * from "./generateSitemap.ts";
export * from "./generateVercel.ts";
export * from "./prerenderPages.ts";
export * from "./runAlepha.ts";
