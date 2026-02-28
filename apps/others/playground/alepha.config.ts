import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  platform: {
    name: "playground",
    environments: {
      production: {
        adapter: "vercel",
      },
    },
  },
});
