import { $inject, t } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

export class CreateAlephaCoreCommands {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Called when no command is provided - delegates to alepha init
   */
  public readonly root = $command({
    root: true,
    description: "Create a new Alepha project",
    args: t.text({
      title: "name",
    }),
    handler: async ({ run, args }) => {
      const name = args;

      // create directory
      await this.fs.mkdir(name);

      // Delegate to alepha init command
      await run(`cd ${name} && npx alepha@latest init ${name}`, {
        alias: "creating project",
      });

      await run(`cd ${name} && npx alepha lint`, {
        alias: "alepha lint",
      });

      await run(`cd ${name} && npx alepha typecheck`, {
        alias: "alepha typecheck",
      });

      await run(`cd ${name} && npx alepha build`, {
        alias: "alepha build",
      });
    },
  });
}
