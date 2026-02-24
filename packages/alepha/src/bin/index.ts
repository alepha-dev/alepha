#!/usr/bin/env node
import { Alepha, run } from "alepha";
import { AlephaCli, version } from "alepha/cli";
import { AlephaCliPlatform } from "alepha/cli/platform";

const alepha = Alepha.create({
  env: {
    APP_NAME: "CLI",
    LOG_LEVEL: "alepha.core:warn,info",
    LOG_FORMAT: "raw",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${version} - Create and manage Alepha projects.`,
  },
});

alepha.with(AlephaCli);
alepha.with(AlephaCliPlatform);

run(alepha);
