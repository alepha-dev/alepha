#!/usr/bin/env node
import { Alepha, run } from "alepha";
import { AlephaCli, version } from "alepha/cli";
import { AlephaCliPlatform } from "alepha/cli/platform";

process.env.LOG_FORMAT ??= "raw";
process.env.LOG_LEVEL ??= "alepha.core:warn,info";

const alepha = Alepha.create({
  env: {
    APP_NAME: "CLI",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${version} - Create and manage Alepha projects.`,
  },
});

alepha.with(AlephaCli);
alepha.with(AlephaCliPlatform);

run(alepha);
