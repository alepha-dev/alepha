import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  entry: {
    server: "./src/dev.ts",
    browser: "./src/ui/main.ts",
    style: "./src/ui/main.css",
  },
});
