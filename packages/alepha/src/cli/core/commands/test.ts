import { $inject, z } from "alepha";
import { $command } from "alepha/command";

import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class TestCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

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

      // Vitest ships embedded in `alepha` (paired with vite) — resolve and
      // run it from alepha's own install, so the project never declares it.
      const vitest = this.utils.resolveBin("vitest", "vitest");
      await run(
        `node "${vitest}" run ${config} ${filter} ${env.VITEST_ARGS}`
          .replace(/\s+/g, " ")
          .trim(),
      );
    },
  });
}
