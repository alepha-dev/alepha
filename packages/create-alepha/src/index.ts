#!/usr/bin/env node

import { Alepha, run } from "alepha";
import { CreateAlephaCoreCommands } from "./CreateAlephaCoreCommands.ts";
import { version } from "./version.ts";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "alepha.core:warn,info",
    LOG_FORMAT: "cli",
    CLI_NAME: "create-alepha",
    CLI_DESCRIPTION: `Create Alepha v${version} - Create a new Alepha project.`,
  },
});

alepha.with(CreateAlephaCoreCommands);

run(alepha);
