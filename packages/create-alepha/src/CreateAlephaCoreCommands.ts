import { $inject, t } from "alepha";
import { ProjectScaffolder } from "alepha/cli";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

const presets = {
  minimal: [] as string[],
  api: ["--api"],
  "full-stack": ["--api", "--react", "--tailwind"],
  "full-stack + auth": ["--api", "--react", "--tailwind", "--auth", "--admin"],
};

export class CreateAlephaCoreCommands {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Interactive project creation.
   */
  public readonly root = $command({
    root: true,
    description: "Create a new Alepha project",
    args: t.optional(
      t.text({
        title: "name",
      }),
    ),
    flags: t.object({
      pm: t.optional(
        t.enum(["yarn", "npm", "pnpm", "bun"], {
          description: "Package manager to use",
        }),
      ),
    }),
    handler: async ({ ask, args, flags, run, root }) => {
      ask.intro("Create Alepha");

      // 1. Project name
      const name =
        args ??
        (await ask("What is your project name?", {
          schema: t.text({ trim: true, lowercase: true }),
          validate: (value) => {
            if (!/^[a-z0-9-]+$/.test(value)) {
              throw new Error(
                "Project name must be lowercase alphanumeric with dashes",
              );
            }
          },
        }));

      // 2. Preset
      const preset = (await ask("Which template would you like?", {
        schema: t.enum(["minimal", "api", "full-stack", "full-stack + auth"]),
      })) as keyof typeof presets;

      // 3. Package manager
      const pm =
        flags.pm ??
        (await ask("Which package manager?", {
          schema: t.enum(["npm", "yarn", "pnpm", "bun"]),
        }));

      // Build flags from preset
      const presetFlags = presets[preset];
      const initFlags: Record<string, boolean | string> = { pm };
      for (const flag of presetFlags) {
        initFlags[flag.replace(/^--/, "")] = true;
      }

      // Create directory
      await this.fs.mkdir(name);

      // Run init directly
      await this.scaffolder.init({
        run,
        root,
        flags: initFlags as any,
        args: name,
      });

      ask.outro("Project ready!");
    },
  });
}
