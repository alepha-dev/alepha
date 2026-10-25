#!/usr/bin/env node
import { run } from "alepha";

import { DevtoolsCommand } from "./cli/DevtoolsCommand.ts";

run(DevtoolsCommand, {
  env: {
    APP_NAME: "CLI",
    CLI_NAME: "alepha-devtools",
    CLI_DESCRIPTION: "Alepha DevTools: every app running on this machine.",
    LOG_FORMAT: (process.env.LOG_FORMAT ?? "cli") as any,
    LOG_LEVEL: process.env.LOG_LEVEL ?? "alepha.core:warn,info",
  },
});
