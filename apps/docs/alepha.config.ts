import { defineConfig } from "alepha/cli/config";
import pkg from "../../packages/alepha/package.json" with { type: "json" };
import { CheckDocsCommand } from "./scripts/check-docs.ts";
import { DocsCommand } from "./scripts/gen-docs.ts";
import { LlmsCommand } from "./scripts/gen-llms.ts";
import { TreeCommand } from "./scripts/gen-tree.ts";

export default defineConfig({
  services: [DocsCommand, TreeCommand, LlmsCommand, CheckDocsCommand],
  env: {
    VITE_BUILD_DATE: new Date().toISOString(),
    VITE_VERSION: pkg.version,
  },
});
