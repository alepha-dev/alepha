#!/usr/bin/env node
import "tsx";
import { $module, Alepha, run } from "@alepha/core";
import { BiomeCommands } from "./commands/BiomeCommands.ts";
import { CoreCommands } from "./commands/CoreCommands.ts";
import { DrizzleCommands } from "./commands/DrizzleCommands.ts";
import { VerifyCommands } from "./commands/VerifyCommands.ts";
import { ViteCommands } from "./commands/ViteCommands.ts";
import { ProcessRunner } from "./services/ProcessRunner.ts";
import { version } from "./version.ts";

const AlephaCli = $module({
  name: "alepha.cli",
  services: [
    ProcessRunner,
    CoreCommands,
    DrizzleCommands,
    VerifyCommands,
    ViteCommands,
    BiomeCommands,
  ],
});

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
