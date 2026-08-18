import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  // Dev ports mirror the e2e band in playwright.port.ts so there is one
  // mapping to remember, not two. Every app otherwise binds 5173.
  dev: { port: 3311 },
  plugins: [
    platform({
      environments: {
        production: { adapter: "cloudflare" },
      },
    }),
  ],
  build: {
    target: "cloudflare",
  },
});
