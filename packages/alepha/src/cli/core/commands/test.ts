import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class TestCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  public readonly test = $command({
    name: "test",
    description: "Run tests using Vitest",
    flags: t.object({
      config: t.optional(
        t.string({
          description: "Path to Vitest config file",
          alias: "c",
        }),
      ),
    }),
    env: t.object({
      VITEST_ARGS: t.optional(
        t.string({
          default: "",
          description:
            "Additional arguments to pass to Vitest. E.g., --coverage",
        }),
      ),
    }),
    handler: async ({ run, root, flags, env }) => {
      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      // Ensure vitest is installed before running
      await this.pm.ensureDependency(root, "vitest", {
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });

      const config = flags.config ? `--config=${flags.config}` : "";

      await run(`vitest run ${config} ${env.VITEST_ARGS}`);
    },
  });
}
