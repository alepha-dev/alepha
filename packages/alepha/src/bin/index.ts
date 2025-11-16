#!/usr/bin/env node
import "tsx";
import { AlephaCli, version } from "alepha/cli";
import { Alepha, run } from "alepha";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "alepha.core:warn,info",
    LOG_FORMAT: "raw",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${version} - Create and manage Alepha projects.`,
  },
});

alepha.with(AlephaCli);

run(alepha);
