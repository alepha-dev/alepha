import { $command } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { ProcessRunner } from "../services/ProcessRunner.ts";
import { ProjectUtils } from "../services/ProjectUtils.ts";

export class BiomeCommands {
  protected readonly log = $logger();
  protected readonly runner = $inject(ProcessRunner);
  protected readonly utils = $inject(ProjectUtils);

  protected readonly biomeFlags = t.object({
    config: t.optional(
      t.text({
        aliases: ["c"],
      }),
    ),
  });

  public readonly format = $command({
    name: "format",
    description: "Format the codebase using Biome",
    flags: this.biomeFlags,
    handler: async ({ flags }) => {
      const configPath = await this.utils.getBiomeConfigPath(flags.config);
      await this.runner.exec(`biome format --fix --config-path=${configPath}`);
    },
  });

  public readonly lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    flags: this.biomeFlags,
    handler: async ({ flags }) => {
      const configPath = await this.utils.getBiomeConfigPath(flags.config);
      await this.runner.exec(
        `biome check --formatter-enabled=false --fix --config-path=${configPath}`,
      );
    },
  });
}
