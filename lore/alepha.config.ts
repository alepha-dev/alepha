import { defineConfig } from "alepha/cli/config";
import { vendor } from "alepha/cli/vendor";

import { LoreCommands } from "./scripts/commands.ts";

export default defineConfig({
  plugins: [
    // Lore runs on the framework's unreleased `main`, synced into `.vendor/`
    // and committed (the Club pattern): a quarter to a third of Lore's work
    // changes the framework too, and waiting for an npm release each time is
    // what this avoids. `yarn vendor:sync` refreshes it. `build: false`: every
    // vendored package loads as source, so a fresh clone needs no build.
    vendor({
      packages: ["alepha", "@alepha/ui"],
      build: false,
    }),
  ],
  // `clean` and `verify` / `v`, each taking the slot of the CLI built-in of
  // the same name: the CLI keeps the last registration.
  services: [LoreCommands],
});
