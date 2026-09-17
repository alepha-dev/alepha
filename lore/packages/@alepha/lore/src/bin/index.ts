#!/usr/bin/env node
import pkg from "@alepha/lore/package.json" with { type: "json" };
import { Alepha, run } from "alepha";
import { AlephaCommand, cliOptions } from "alepha/command";

import { AlephaLoreCli } from "../cli/index.ts";
import { LoreConventions } from "../cli/services/LoreConventions.ts";

/**
 * The `lore` binary.
 *
 * ```bash
 * npm i -g "@alepha/lore"
 * lore login
 * lore quality push -p alepha
 * ```
 *
 * ## ⚠️ `AlephaCommand`, never `AlephaCli`
 *
 * `alepha`'s own bin registers `AlephaCli`, which is `build`, `dev`, `db`,
 * `verify` and every build task. Registering it here would publish a second
 * copy of the whole Alepha CLI under a `lore` name and a second release
 * cadence. `AlephaCommand` is the part this needs: `CliProvider`, the
 * `$command` primitive, the output provider and the runner.
 *
 * That is necessary and not sufficient, and the distinction cost this epic a
 * false premise. `AlephaCommand` keeps the build commands out of the MODULE
 * graph; keeping them out of the INJECT graph is a separate property, because
 * `Alepha.inject` registers the module that declares a service. It holds
 * today because nothing under `AlephaLoreCli` injects a command from
 * `alepha/cli`, and `commandSurface.spec.ts` is what keeps it holding.
 */
const alepha = Alepha.create({
  env: {
    APP_NAME: "CLI",
    CLI_NAME: "lore",
    LOG_FORMAT: (process.env.LOG_FORMAT ?? "cli") as any,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "alepha.core:warn,info",
  },
});

alepha.with(AlephaCommand);
alepha.with(AlephaLoreCli);

// Through the store and not `CLI_DESCRIPTION`: the conventions block is a
// dozen lines, and an environment variable schema caps a text at 255
// characters.
alepha.store.mut(cliOptions, (options) => ({
  ...options,
  description: LoreConventions.describe(pkg.version),
}));

run(alepha);
