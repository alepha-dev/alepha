#! /usr/bin/env node
import { run } from "alepha";
import { PackageBuilderCli } from "alepha/cli";

run(PackageBuilderCli, {
  env: {
    LOG_FORMAT: "raw",
    LOG_LEVEL: "alepha.command:info,warn",
  },
});
