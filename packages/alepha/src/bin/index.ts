#!/usr/bin/env node
import { Alepha, run } from "alepha";
import { AlephaCli, version } from "alepha/cli";

const alepha = Alepha.create({
  env: {
    APP_NAME: "CLI",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${version} - Create and manage Alepha projects.`,
    LOG_FORMAT: (process.env.LOG_FORMAT ?? "cli") as any,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "alepha.core:warn,info",
  },
});

alepha.with(AlephaCli);

run(alepha);
