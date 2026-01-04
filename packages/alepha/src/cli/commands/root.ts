import { $inject, t } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import { version } from "../version.ts";

export class RootCommand {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);

  /**
   * Called when no command is provided
   */
  public readonly root = $command({
    root: true,
    flags: t.object({
      version: t.optional(
        t.boolean({
          description: "Show Alepha CLI version",
          aliases: ["v"],
        }),
      ),
    }),
    handler: async ({ flags }) => {
      if (flags.version) {
        this.log.info(version);
        return;
      }

      this.cli.printHelp();
    },
  });
}
