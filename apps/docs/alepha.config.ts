import { defineConfig } from "alepha/cli";
import pkg from "../../packages/alepha/package.json" with { type: "json" };
import { LlmsCommand } from "./scripts/gen-llms.ts";
import { PackagesCommand } from "./scripts/gen-packages.ts";
import { TreeCommand } from "./scripts/gen-tree.ts";

export default defineConfig({
  services: [PackagesCommand, TreeCommand, LlmsCommand],
  build: {
    sitemap: { hostname: "https://alepha.dev" },
  },
  env: {
    VITE_BUILD_DATE: new Date().toISOString(),
    VITE_VERSION: pkg.version,
  },
});
