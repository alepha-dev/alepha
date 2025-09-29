#!/usr/bin/env node
import { run } from "@alepha/core";
import pkg from "../package.json" with { type: "json" };
import { AlephaCli } from "./AlephaCli.ts";

run(AlephaCli, {
	env: {
		LOG_LEVEL: "alepha.core:warn,info",
		LOG_FORMAT: "raw",
		CLI_NAME: "alepha",
		CLI_DESCRIPTION: `Alepha CLI v${pkg.version} - Create and manage Alepha projects.`,
	},
});
