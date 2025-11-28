#! /usr/bin/env node
import { run } from "alepha";
import { AlephaPackageBuilderCli } from "alepha/cli";

run(AlephaPackageBuilderCli, {
  env: {
    LOG_FORMAT: "raw",
    LOG_LEVEL: "alepha.command:info,warn",
  },
});
