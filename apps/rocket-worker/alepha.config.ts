import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  build: {
    target: "cloudflare",
  },
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "cloudflare",
          domain: "rocket-worker.alepha.dev",
          zone: "alepha.dev",
        },
      },
    }),
  ],
});
