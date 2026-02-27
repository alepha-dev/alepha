import { defineConfig } from "alepha/cli";

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
