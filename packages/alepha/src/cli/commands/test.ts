import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class TestCommand {
  protected readonly utils = $inject(AlephaCliUtils);

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
    handler: async ({ root, flags, env }) => {
      await this.utils.ensureConfig(root, {
        tsconfigJson: true,
        viteConfigTs: true,
      });

      // Ensure vitest is installed before running
      await this.utils.ensureDependency(root, "vitest");

      const config = flags.config ? `--config=${flags.config}` : "";

      await this.utils.exec(`vitest run ${config} ${env.VITEST_ARGS}`);
    },
  });
}
