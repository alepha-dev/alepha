import { defineConfig } from "alepha/cli/config";

import { AlephaCommands } from "./scripts/commands.ts";
import { PackageDocsCommand } from "./scripts/package-docs.ts";

export default defineConfig({
  plugins: [
    // Register repository commands after the built-ins.
    AlephaCommands,
    PackageDocsCommand,
  ],
});
