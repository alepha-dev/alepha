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
   * Unlike the old four-way question, `--preset` does prompt when it is left
   * unset: `ask.choice` offers the same two values the flag accepts. Every
   * question below works the same way, gated on the flag that would otherwise
   * answer it, so a fully flagged invocation never prompts at all:
   * `create-alepha my-app --preset saas` runs start to finish without a
   * question, which is what a script or CI needs. Leave a flag out and the
   * command asks instead of guessing.
   *
   * The package-manager question is the one exception, and for a different
   * reason: it was asking something the CLI already knows. `PackageManagerUtils`
   * reads `npm_config_user_agent`, which every manager sets when it runs a
   * binary, so `yarn create alepha` resolves to yarn and `pnpm create alepha`
   * to pnpm without anyone being asked. Prompting on top of that could only
   * produce a worse answer — a project installed with a manager the user did
   * not invoke. `--pm` still overrides, for the case where the two genuinely
   * differ.
   *
   * `--yes` answers every remaining question with its default, the way
   * `npm init -y` does, so a script gets the shape a human gets by pressing
   * Enter without spelling out each flag, and it keeps covering questions
   * added later. It was born of a devtools question whose only flag was the
   * negative `--no-devtools`, which left no fully flagged path to the default
   * shape (#Q1647). That question left with devtools itself (#Q2280); `--yes`
   * stayed for the preset and whatever comes next.
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
      yes: z
        .boolean()
        .meta({ aliases: ["y"] })
        .describe(
          "Answer every remaining question with its default, so the command runs with stdin closed. Needs the project name, which has no default. Flags still win over it. Short form: -y",
        )
        .optional(),
    }),
    handler: async ({ ask, args, flags, run, root }) => {
      ask.intro("Create Alepha");

      // 1. Project name.
      //
      // The one question `--yes` cannot answer: every other prompt has a
      // default and a name does not. Refused with the fix in the message
      // rather than prompting anyway, because `--yes` is what a script
      // passes and a script has no stdin to answer with.
      if (flags.yes && !args) {
        throw new AlephaError(
          "--yes needs a project name, which is the one question with no default. Pass it as an argument: create-alepha my-app --yes",
        );
      }
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
        (flags.yes
          ? "default"
          : await ask.choice(
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
        },
        args: name,
      });

      // No `ask.outro` here: `scaffolder.init` already signs off with
      // "Project ready!" and the two commands to run next, and it does so for
      // `alepha init` too. Calling both printed the line twice.
    },
  });
}
