import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class FormatCommand {
  protected readonly utils = $inject(AlephaCliUtils);

  public readonly format = $command({
    name: "format",
    description: "Format the codebase using Biome",
    handler: async ({ root }) => {
      await this.utils.ensureConfig(root, { biomeJson: true });
      await this.utils.ensureDependency(root, "@biomejs/biome");
      await this.utils.exec("biome format --fix");
    },
  });
}
