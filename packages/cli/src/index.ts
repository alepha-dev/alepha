#!/usr/bin/env node
import { Alepha, run } from "@alepha/core";
import pkg from "../package.json" with { type: "json" };
import { CoreCommands } from "./CoreCommands.ts";
import { DbCommands } from "./DbCommands.ts";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "alepha.core:warn,info",
    LOG_FORMAT: "raw",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${pkg.version} - Create and manage Alepha projects.`,
  },
});

alepha.with(CoreCommands);
alepha.with(DbCommands);

run(alepha);
