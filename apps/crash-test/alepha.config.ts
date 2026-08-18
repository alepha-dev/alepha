import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  // Dev ports mirror the e2e band in playwright.port.ts so there is one
  // mapping to remember, not two. Every app otherwise binds 5173.
  dev: { port: 3306 },
  //
  // entry: {
  //   server: "src/main.server.ts",
  //   browser: "src/main.browser.ts",
  //   style: "src/main.css",
  // },
  //
  // build: {
  //   target: "docker",
  //   runtime: "node",
  // },
  //
  // plugins: [
  //   platform({
  //     environments: {
  //       production: { adapter: "cloudflare" },
  //     },
  //   }),
  // ],
  //
  // env: {
  //   VITE_BUILD_DATE: new Date().toISOString(),
  //   VITE_VERSION: pkg.version,
  // },
});
