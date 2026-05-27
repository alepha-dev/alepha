#!/usr/bin/env node
import { Alepha, run } from "alepha";
import { AlephaCli, version } from "alepha/cli";
import { AlephaCliPlatformPlugin } from "alepha/cli/platform";

const alepha = Alepha.create({
  env: {
    APP_NAME: "CLI",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${version} - Create and manage Alepha projects.`,
    LOG_FORMAT: (process.env.LOG_FORMAT ?? "raw") as any,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "alepha.core:warn,info",
  },
});

alepha.with(AlephaCli);
// Always register the platform plugin so `alepha platform <op>` works
// even when no alepha.config.ts is present (e.g. prebuilt artifacts
// shipped by Alepha Rocket that only ship dist/ + migrations/ — the
// platform config comes from dist/manifest.json instead).
alepha.with(AlephaCliPlatformPlugin);

run(alepha);
