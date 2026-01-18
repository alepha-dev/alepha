import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class FormatCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  public readonly format = $command({
    name: "format",
    description: "Format the codebase using Biome",
    handler: async ({ root }) => {
      await this.scaffolder.ensureConfig(root, { biomeJson: true });
      await this.pm.ensureDependency(root, "@biomejs/biome", {
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });
      await this.utils.exec("biome format --fix");
    },
  });
}
