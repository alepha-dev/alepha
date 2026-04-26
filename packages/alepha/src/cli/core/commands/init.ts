import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class InitCommand {
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Ensure the project has the necessary Alepha configuration files.
   * Add the correct dependencies to package.json and install them.
   */
  public readonly init = $command({
    name: "init",
    description: "Add missing Alepha configuration files to the project",
    args: t.optional(
      t.text({
        title: "path",
        trim: true,
        lowercase: true,
      }),
    ),
    flags: t.object({
      pm: t.optional(
        t.enum(["yarn", "npm", "pnpm", "bun"], {
          description: "Package manager to use",
        }),
      ),
      // choose which modules to scaffold
      api: t.optional(
        t.boolean({
          description: "Include API module structure (src/api/)",
        }),
      ),
      react: t.optional(
        t.boolean({
          aliases: ["r"],
          description: "Include React dependencies and web module (src/web/)",
        }),
      ),
      tailwind: t.optional(
        t.boolean({
          description: "Include Tailwind CSS with Vite plugin. Implies --react",
        }),
      ),
      test: t.optional(
        t.boolean({ description: "Include Vitest and create test directory" }),
      ),
      force: t.optional(
        t.boolean({
          aliases: ["f"],
          description: "Override existing files",
        }),
      ),
    }),
    handler: async ({ run, flags, root, args }) => {
      await this.scaffolder.init({ run, flags, root, args });
    },
  });
}
