import { defineConfig } from "alepha/cli/config";
import { devtools } from "alepha/cli/devtools";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    devtools(),
    platform({
      environments: {
        production: {
          domain: "lore.alepha.dev",
          adapter: "cloudflare",
        },
      },
    }),
  ],
});
