import { defineConfig } from "alepha/cli";
import { LlmsCommand } from "./scripts/gen-llms.ts";
import { PackagesCommand } from "./scripts/gen-packages.ts";
import { TreeCommand } from "./scripts/gen-tree.ts";

export default defineConfig(() => ({
  services: [PackagesCommand, TreeCommand, LlmsCommand],
}));
