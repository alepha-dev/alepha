import { $inject, z } from "alepha";
import { ProjectScaffolder } from "alepha/cli";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

export class CreateAlephaCoreCommands {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Interactive project creation.
   *
   * There used to be a "which template?" question offering minimal / api /
   * full-stack / full-stack + saas, mapped to `--api`, `--react`, `--tailwind`
   * and `--saas`. `alepha init` dropped those flags when it settled on a single
   * project shape ("Every project gets the same full-stack shape […] There is
   * nothing to opt into"), and the extra keys reached it through an `as any`,
   * so they were silently ignored and all four answers built the same project.
   * The question is gone rather than reinstated: the flags it fed no longer
   * exist, and asking something whose answer is discarded is worse than not
   * asking.
   *
   * What remains takes both its inputs from argv — `create-alepha my-app --pm
   * npm` runs start to finish without a prompt, which is what a CI needs.
   */
  public readonly root = $command({
    root: true,
    description: "Create a new Alepha project",
    args: z
      .text({
        title: "name",
      })
      .optional(),
    flags: z.object({
      pm: z
        .enum(["yarn", "npm", "pnpm", "bun"])
        .describe("Package manager to use")
        .optional(),
    }),
    handler: async ({ ask, args, flags, run, root }) => {
      ask.intro("Create Alepha");

      // 1. Project name
      const name =
        args ??
        (await ask("What is your project name?", {
          schema: z.text({ trim: true, lowercase: true }),
          validate: (value) => {
            if (!/^[a-z0-9-]+$/.test(value)) {
              throw new Error(
                "Project name must be lowercase alphanumeric with dashes",
              );
            }
          },
        }));

      // 2. Package manager
      const pm =
        flags.pm ??
        (await ask("Which package manager?", {
          schema: z.enum(["npm", "yarn", "pnpm", "bun"]),
        }));

      // Create directory
      await this.fs.mkdir(name);

      // Run init directly. No cast: these are exactly the flags `init` accepts,
      // and keeping it that way is what makes a future removal a type error
      // here instead of a silently ignored key.
      await this.scaffolder.init({
        run,
        root,
        flags: { pm },
        args: name,
      });

      ask.outro("Project ready!");
    },
  });
}
