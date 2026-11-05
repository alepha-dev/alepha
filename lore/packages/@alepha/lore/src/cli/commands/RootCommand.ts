import { $command } from "alepha/command";

/**
 * What a bare `lore` does: print the command list, the page `lore --help`
 * prints.
 *
 * Without a root command, `CliProvider` reads a run with no subcommand as a
 * process that is not a CLI and returns silently with exit 0, so a bare
 * `lore` printed nothing and looked like a broken install. For the root,
 * whose name is `""`, `help()` prints the top-level list.
 */
export class RootCommand {
  /**
   * Called when no command is given.
   */
  public readonly root = $command({
    root: true,
    description: "Print the command list, as lore --help does.",
    handler: ({ help }) => help(),
  });
}
