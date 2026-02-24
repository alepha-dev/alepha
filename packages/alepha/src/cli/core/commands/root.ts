import { $inject, Alepha, t } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { version } from "../version.ts";

export class RootCommand {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly color = $inject(ConsoleColorProvider);

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
        this.log.info(this.color.set("WHITE_BOLD", `Alepha v${version}`));
        if (this.alepha.isBun()) {
          this.log.info(this.color.set("GREY_DARK", `└─ Bun v${Bun.version}`));
        } else {
          this.log.info(
            this.color.set("GREY_DARK", `└─ Node ${process.version}`),
          );
        }
        return;
      }

      this.cli.printHelp();
    },
  });
}
