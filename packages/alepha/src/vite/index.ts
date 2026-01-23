import type { Alepha } from "alepha";

// Helpers (for advanced use)
export * from "./helpers/createBufferedLogger.ts";
export * from "./helpers/importVite.ts";
export * from "./helpers/importViteReact.ts";
// Plugins (public API)
export * from "./plugins/viteAlephaSsrPreload.ts";
export * from "./plugins/viteCompress.ts";
// Tasks (for CLI integration)
export * from "./tasks/index.ts";

declare global {
  var __alepha: Alepha;
  var __cli_alepha: Alepha;
}
