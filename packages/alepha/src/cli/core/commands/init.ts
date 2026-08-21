import { $inject, z } from "alepha";
import { $command } from "alepha/command";

import { presetSchema } from "../schemas/presetSchema.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class InitCommand {
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Ensure the project has the necessary Alepha configuration files.
   * Add the correct dependencies to package.json and install them.
   *
   * Every project gets the same full-stack shape — API (`src/api/`), web
   * (`src/web/`) and Tailwind. A single canonical layout is what makes an
   * Alepha project legible at a glance, to humans and to AI assistants alike.
   *
   * `--preset` branches above that line, never inside it: `saas` adds the
   * identity surface (`@alepha/ui` + auth / account / admin) on top of the
   * same skeleton, so the two shapes differ by what is present, not by where
   * anything lives. See {@link presetSchema}.
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
      preset: presetSchema
        .describe(
          "Project shape: 'default' (API + web + Tailwind) or 'saas' (adds @alepha/ui with auth, account and admin)",
        )
        .optional(),
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
