import { $inject, z } from "alepha";
import { $command } from "alepha/command";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class InitCommand {
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Ensure the project has the necessary Alepha configuration files.
   * Add the correct dependencies to package.json and install them.
   *
   * Every project gets the same full-stack shape — API (`src/api/`), web
   * (`src/web/`) and Tailwind. There is nothing to opt into. A single
   * canonical layout is what makes an Alepha project legible at a glance,
   * to humans and to AI assistants alike.
   */
  public readonly init = $command({
    name: "init",
    description: "Add missing Alepha configuration files to the project",
    args: z
      .text({
        title: "path",
        trim: true,
      })
      .optional(),
    flags: z.object({
      pm: z
        .enum(["yarn", "npm", "pnpm", "bun"])
        .describe("Package manager to use")
        .optional(),
      force: z
        .boolean()
        .meta({ aliases: ["f"] })
        .describe("Override existing files")
        .optional(),
      "no-devtools": z
        .boolean()
        .describe(
          "Skip @alepha/devtools. It is included by default for apps (never for workspace packages) and is dev-only — no production bundle cost",
        )
        .optional(),
    }),
    handler: async ({ run, flags, root, args }) => {
      await this.scaffolder.init({ run, flags, root, args });
    },
  });
}
