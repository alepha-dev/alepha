import { $inject } from "alepha";
import { $command } from "alepha/command";
import { ChangelogCommand } from "./gen/changelog.ts";
import { OpenApiCommand } from "./gen/openapi.ts";

export class GenCommand {
  protected readonly changelog = $inject(ChangelogCommand);
  protected readonly openapi = $inject(OpenApiCommand);

  public readonly gen = $command({
    name: "gen",
    description: "Generate code, documentation, ...",
    children: [this.changelog.command, this.openapi.command],
    handler: async ({ help }) => {
      help();
    },
  });
}
