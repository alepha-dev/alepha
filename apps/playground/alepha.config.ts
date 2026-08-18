import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  // Dev ports mirror the e2e band in playwright.port.ts so there is one
  // mapping to remember, not two. Every app otherwise binds 5173.
  dev: { port: 3304 },
});
