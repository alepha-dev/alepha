#!/usr/bin/env node
import "tsx";
import { $module } from "alepha";
import { BiomeCommands } from "./commands/BiomeCommands.ts";
import { CoreCommands } from "./commands/CoreCommands.ts";
import { DrizzleCommands } from "./commands/DrizzleCommands.ts";
import { VerifyCommands } from "./commands/VerifyCommands.ts";
import { ViteCommands } from "./commands/ViteCommands.ts";
import { ProcessRunner } from "./services/ProcessRunner.ts";

export * from "./packageBuilderCli.ts";
export * from "./version.ts";

export const AlephaCli = $module({
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
