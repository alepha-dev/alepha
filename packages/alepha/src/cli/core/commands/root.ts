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
    handler: async ({ flags, print }) => {
      if (flags.version) {
        // Bare on the first line, and through `print` rather than the logger.
        // `alepha --version` used to come back as `18:21:36 I Alepha v0.24.0`
        // plus a runtime line — 112 bytes of timestamped, coloured log, whose
        // shape followed `LOG_FORMAT`. `VERSION=$(alepha --version)` now yields
        // exactly `0.24.0`, the way node, npm and yarn all behave.
        print(version);

        // The runtime is worth having in a bug report but has no business in a
        // script's variable, so it is a second line and only on a terminal.
        // Piping takes the first line and nothing else.
        if (process.stdout?.isTTY) {
          print(
            this.color.set(
              "GREY_DARK",
              this.alepha.isBun()
                ? `└─ Bun v${Bun.version}`
                : `└─ Node ${process.version}`,
            ),
          );
        }
        return;
      }

      this.cli.printHelp();
    },
  });
}
