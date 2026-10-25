import { defineConfig } from "alepha/cli/config";

import { LoreCommands } from "./scripts/commands.ts";

export default defineConfig({
  plugins: [
    // `clean` and `verify` / `v`, each taking the slot of the CLI built-in of
    // the same name: the CLI keeps the last registration. Lore builds on the
    // framework's source in ../framework, resolved by `workspace:*`.
    LoreCommands,
  ],
});
