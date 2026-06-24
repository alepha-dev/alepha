import { $inject, Alepha, z } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { version } from "../alephaPackageJson.ts";

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
    flags: z.object({
      version: z
        .boolean()
        .meta({ aliases: ["v"] })
        .describe("Show Alepha CLI version")
        .optional(),
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
