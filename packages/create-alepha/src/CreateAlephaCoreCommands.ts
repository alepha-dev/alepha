import { $inject, AlephaError, z } from "alepha";
import { ProjectScaffolder, presetSchema } from "alepha/cli";
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
   * and `--saas`. Those four keys reached `init` through an `as any` and were
   * silently ignored, so all four answers built the same project; the question
   * was removed along with them when `init` settled on a single shape.
   *
   * `--preset` is not that question coming back. The old flags cut *below* the
   * project skeleton — whether you got an API, a client, Tailwind — which is
   * exactly the axis that made two Alepha projects unrecognisable to each
   * other. A preset cuts above it: every project still has `src/api/`,
   * `src/web/` and Tailwind in the same places, and `saas` only decides
   * whether the identity surface is mounted on top. It is also typed and
   * forwarded, so a value this package accepts but `init` does not is a
   * compile error rather than a silently dropped key.
   *
   * Still not a prompt, though. A preset is a decision about the project, and
   * the name is already positional, so `create-alepha my-app --preset saas`
   * runs start to finish without one — which is what a CI needs.
   *
   * The package-manager question went the same way, for a different reason: it
   * was asking something the CLI already knows. `PackageManagerUtils` reads
   * `npm_config_user_agent`, which every manager sets when it runs a binary, so
   * `yarn create alepha` resolves to yarn and `pnpm create alepha` to pnpm
   * without anyone being asked. Prompting on top of that could only produce a
   * worse answer — a project installed with a manager the user did not invoke.
   * `--pm` still overrides, for the case where the two genuinely differ.
   *
   * What is left is the name, and it is positional: `create-alepha my-app` runs
   * start to finish without a prompt, which is what a CI needs.
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
      preset: presetSchema
        .describe(
          "Project shape: 'default' (API + web + Tailwind) or 'saas' (adds @alepha/ui with auth, account and admin)",
        )
        .optional(),
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
        (await ask.prompt("What is your project name?", {
          schema: z.text({ trim: true, lowercase: true }),
          validate: (value) => {
            if (!/^[a-z0-9-]+$/.test(value)) {
              throw new AlephaError(
                "Project name must be lowercase alphanumeric with dashes",
              );
            }
          },
        }));

      // 2. Project shape, unless the caller already picked one
      const preset =
        flags.preset ??
        (await ask.choice(
          "Project shape:",
          [
            {
              value: "default",
              label: "default (API + web + Tailwind)",
            },
            {
              value: "saas",
              label: "saas (adds @alepha/ui with auth, account and admin)",
            },
          ],
          { default: "default" },
        ));

      // 3. DevTools is dev-only and costs nothing in a production bundle, so
      // the default is yes.
      const devtools = await ask.confirm("Include @alepha/devtools?", {
        default: true,
      });

      // Create directory
      await this.fs.mkdir(name);

      // `pm` is passed through undefined unless the user forced one, so that
      // `init` runs its own resolution — lockfiles, then workspace, then the
      // invoking manager via `npm_config_user_agent`. Prompting for it would
      // replace a good answer with a worse one.
      //
      // No cast: these are exactly the flags `init` accepts, and keeping it
      // that way is what makes a future removal a type error here instead of a
      // silently ignored key.
      await this.scaffolder.init({
        run,
        root,
        flags: {
          pm: flags.pm,
          preset,
          "no-devtools": devtools ? undefined : true,
        },
        args: name,
      });

      ask.outro("Project ready!");
    },
  });
}
