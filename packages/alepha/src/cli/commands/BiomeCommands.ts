import { $inject } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { ProcessRunner } from "../services/ProcessRunner.ts";
import { ProjectUtils } from "../services/ProjectUtils.ts";

export class BiomeCommands {
  protected readonly log = $logger();
  protected readonly runner = $inject(ProcessRunner);
  protected readonly utils = $inject(ProjectUtils);

  public readonly format = $command({
    name: "format",
    description: "Format the codebase using Biome",
    handler: async ({ root }) => {
      await this.utils.ensureConfig(root, { biomeJson: true });
      await this.runner.exec(`biome format --fix`);
    },
  });

  public readonly lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    handler: async ({ root }) => {
      await this.utils.ensureConfig(root, { biomeJson: true });
      await this.runner.exec(`biome check --formatter-enabled=false --fix`);
    },
  });
}
