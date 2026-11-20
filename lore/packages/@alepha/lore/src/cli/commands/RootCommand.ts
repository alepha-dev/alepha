import pkg from "@alepha/lore/package.json" with { type: "json" };
import { $inject, Alepha, z } from "alepha";
import { $command } from "alepha/command";
import { ConsoleColorProvider } from "alepha/logger";

/**
 * What a bare `lore` does: print the command list, the page `lore --help`
 * prints. With `--version` (`-v`), the CLI's version instead (#Q3994).
 *
 * Without a root command, `CliProvider` reads a run with no subcommand as a
 * process that is not a CLI and returns silently with exit 0, so a bare
 * `lore` printed nothing and looked like a broken install. For the root,
 * whose name is `""`, `help()` prints the top-level list.
 *
 * The version is bare on the first line, through `print` rather than the
 * logger, as `alepha --version` does: `VERSION=$(lore --version)` yields
 * exactly `0.39.0`. The runtime is a second line on a terminal only, so a
 * pipe takes the version and nothing else. `-v` is free: `CliProvider`
 * keeps it off `--verbose` for this, and no `lore` command uses it.
 */
export class RootCommand {
  protected readonly alepha = $inject(Alepha);
  protected readonly color = $inject(ConsoleColorProvider);

  /**
   * Called when no command is given.
   */
  public readonly root = $command({
    root: true,
    description: "Print the command list, as lore --help does.",
    flags: z.object({
      version: z
        .boolean()
        .meta({ aliases: ["v"] })
        .describe("Print the lore CLI's version")
        .optional(),
    }),
    handler: ({ flags, help, print }) => {
      if (!flags.version) {
        help();
        return;
      }
      print(pkg.version);
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
    },
  });
}
