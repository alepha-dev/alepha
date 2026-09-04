#!/usr/bin/env node
import pkg from "@alepha/lore/package.json" with { type: "json" };
import { Alepha, run } from "alepha";
import { AlephaCommand } from "alepha/command";

import { AlephaLoreCliPlugin } from "../cli/index.ts";

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
 * today because nothing under `AlephaLoreCliPlugin` injects a command from
 * `alepha/cli`, and `commandSurface.spec.ts` is what keeps it holding.
 */
const alepha = Alepha.create({
  env: {
    APP_NAME: "CLI",
    CLI_NAME: "lore",
    CLI_DESCRIPTION: `Lore CLI v${pkg.version} - Talk to a Lore instance from a build or a CI job.`,
    LOG_FORMAT: (process.env.LOG_FORMAT ?? "cli") as any,
    // ⚠️ `alepha.crypto:error` is not noise-hiding. `HttpClient` pulls
    // `alepha.crypto` in transitively, and `SecretProvider` then warns on
    // every single invocation that `APP_SECRET` is the built-in default. It
    // is a true statement about a process that signs nothing: the one secret
    // this CLI holds is the Lore token, and `LoreTokenStore` writes it to
    // `~/.alepha/credentials.json` in the clear rather than encrypting it.
    // The plugin never showed it only because a module registered from
    // `alepha.config.ts` arrives after `configure` has already run.
    LOG_LEVEL:
      process.env.LOG_LEVEL ?? "alepha.core:warn,alepha.crypto:error,info",
  },
});

alepha.with(AlephaCommand);
alepha.with(AlephaLoreCliPlugin);

run(alepha);
