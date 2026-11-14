import { $inject } from "alepha";
import { $command } from "alepha/command";

import { GenEnvCommand } from "./gen/env.ts";
import { OpenApiCommand } from "./gen/openapi.ts";

export class GenCommand {
  protected readonly openapi = $inject(OpenApiCommand);
  protected readonly genEnv = $inject(GenEnvCommand);

  public readonly gen = $command({
    name: "gen",
    description: "Generate code, documentation, ...",
    children: [this.openapi.command, this.genEnv.command],
    handler: async ({ help }) => {
      help();
    },
  });
}
