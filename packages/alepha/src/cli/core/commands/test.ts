import { $inject, z } from "alepha";
import { $command } from "alepha/command";

import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class TestCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * The vitest flags that turn a run into a pair of machine-readable reports,
   * written where every Alepha project already ignores them: `coverage/` is
   * vitest's own `reportsDirectory` and is gitignored by the templates.
   *
   * This is the convention half of `lore quality push`: the command
   * finds these two files without being told where they are, which is the
   * only reason it does not need a path argument.
   *
   * Every flag below is here because running vitest 4.1.10 said so, and the
   * obvious shorter spelling is wrong in each case:
   *
   * - `--coverage.reporter=json-summary` REPLACES the config's reporter list.
   *   Ask for the summary alone and the browsable HTML report silently stops
   *   being written, so `html` is named again here. Repeated occurrences of
   *   the flag accumulate, which is what makes naming both work.
   * - `--reporter=json` REPLACES the default reporter. On its own it writes
   *   the file and reduces the whole run's output to one line, so CI would
   *   trade every readable failure for a report nobody reads on a green run.
   * - `--outputFile.json=` is the keyed form. Bare `--outputFile=` names a
   *   path with nothing saying which of the two reporters owns it.
   */
  /**
   * `--project` for each name in a comma-separated list.
   *
   * A repeated flag is what Vitest itself takes, and a repeated flag is not
   * what this CLI parses: an array-typed flag here expects a JSON value, which
   * is no way to name two projects. So the list is one string on the way in
   * and one flag per entry on the way out.
   *
   * The values reach the shell as literal arguments, so a glob is passed
   * through rather than resolved against the working directory on the way.
   * That matters because selecting a workspace whole is a glob: a workspace
   * with browser specs owns both `<name>` and `<name>:jsdom`, and only
   * `<name>*` picks up the pair.
   */
  protected projectArgs(project?: string): string {
    if (!project) {
      return "";
    }

    return project
      .split(",")
      .map((it) => it.trim())
      .filter(Boolean)
      .map((it) => `--project ${it}`)
      .join(" ");
  }

  protected reportArgs(): string {
    return [
      "--coverage",
      "--coverage.reporter=html",
      "--coverage.reporter=json-summary",
      "--reporter=default",
      "--reporter=json",
      "--outputFile.json=coverage/test-results.json",
    ].join(" ");
  }

  public readonly test = $command({
    name: "test",
    description:
      "Run tests using Vitest. Pass a filter to run only matching specs, e.g. `alepha test user` or `alepha test test/auth.spec.ts`",
    args: z
      .text({
        title: "filter",
        description: "Only run spec files whose path matches this string",
      })
      .optional(),
    flags: z.object({
      config: z
        .string()
        .meta({ alias: "c" })
        .describe("Path to Vitest config file")
        .optional(),
      coverage: z
        .boolean()
        .describe(
          "Measure coverage and write coverage/coverage-summary.json and coverage/test-results.json",
        )
        .optional(),
      project: z
        .string()
        .meta({ alias: "p" })
        .describe(
          "Only run these Vitest projects, comma-separated. Accepts globs, e.g. `lore*`",
        )
        .optional(),
    }),
    env: z.object({
      VITEST_ARGS: z
        .string()
        .describe("Additional arguments to pass to Vitest. E.g., --coverage")
        .default("")
        .optional(),
    }),
    handler: async ({ run, root, flags, env, args }) => {
      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      const config = flags.config ? `--config=${flags.config}` : "";

      // The positional arg is forwarded to Vitest as a filename filter —
      // `alepha test user` runs only specs whose path matches "user".
      const filter = args ? JSON.stringify(args) : "";

      const reports = flags.coverage ? this.reportArgs() : "";

      const projects = this.projectArgs(flags.project);

      // Vitest ships embedded in `alepha` (paired with vite) — resolve and
      // run it from alepha's own install, so the project never declares it.
      const vitest = this.utils.resolveBin("vitest", "vitest");

      // `VITEST_ARGS` stays last on the line. Nothing here is precedence in
      // the API sense: this is one concatenated string, so the only thing
      // that makes the escape hatch an escape hatch is that it is appended
      // after the flags built above.
      await run(
        `node "${vitest}" run ${config} ${projects} ${filter} ${reports} ${env.VITEST_ARGS}`
          .replace(/\s+/g, " ")
          .trim(),
      );
    },
  });
}
