import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class LintCommand {
  protected readonly utils = $inject(AlephaCliUtils);

  public readonly lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    handler: async ({ root }) => {
      await this.utils.ensureConfig(root, { biomeJson: true });
      await this.utils.ensureDependency(root, "@biomejs/biome");
      await this.utils.exec("biome check --formatter-enabled=false --fix");
    },
  });
}
