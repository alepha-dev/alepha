#!/usr/bin/env node
import "tsx";
// ---------------------------------------------------------------------------------------------------------------------
import { Alepha, run } from "@alepha/core";
import pkg from "../package.json" with { type: "json" };
import { BiomeCommands } from "./commands/BiomeCommands.ts";
import { CoreCommands } from "./commands/CoreCommands.ts";
import { DrizzleCommands } from "./commands/DrizzleCommands.ts";
import { VerifyCommands } from "./commands/VerifyCommands.ts";
import { ViteCommands } from "./commands/ViteCommands.ts";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "alepha.core:warn,info",
    LOG_FORMAT: "raw",
    CLI_NAME: "alepha",
    CLI_DESCRIPTION: `Alepha CLI v${pkg.version} - Create and manage Alepha projects.`,
  },
});

alepha.with(CoreCommands);
alepha.with(ViteCommands);
alepha.with(BiomeCommands);
alepha.with(VerifyCommands);
alepha.with(DrizzleCommands);

run(alepha);
