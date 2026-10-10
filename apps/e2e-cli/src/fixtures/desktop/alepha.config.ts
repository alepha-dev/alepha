import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: { runtime: ["bun"] },
  desktop: {
    name: "Desktop Fixture",
    identifier: "dev.alepha.desktop-fixture",
  },
});
