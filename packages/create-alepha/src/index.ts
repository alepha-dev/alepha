#!/usr/bin/env node
/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | tooling | rare | stable |
 *
 * Quick project setup tool.
 *
 * **Features:**
 * - `npx create-alepha` to bootstrap projects
 * - Template selection
 * - Environment configuration
 * - Package manager detection
 *
 * @module create-alepha
 */
import { Alepha, run } from "alepha";
import { CreateAlephaCoreCommands } from "./CreateAlephaCoreCommands.ts";
import { version } from "./version.ts";

const alepha = Alepha.create({
  env: {
    LOG_LEVEL: "alepha.core:warn,info",
    LOG_FORMAT: "raw",
    CLI_NAME: "create-alepha",
    CLI_DESCRIPTION: `Create Alepha v${version} - Create a new Alepha project.`,
  },
});

alepha.with(CreateAlephaCoreCommands);

run(alepha);
