import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  entry: {
    server: "./src/ui/main.ts",
    browser: "./src/ui/main.ts",
    style: "./src/ui/main.css",
  },
});
