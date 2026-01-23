import { defineConfig } from "alepha/cli";

export default defineConfig({
  entry: {
    server: "src/ui/main.ts",
    browser: "src/ui/main.ts",
    style: "src/ui/styles.css",
  },
});
