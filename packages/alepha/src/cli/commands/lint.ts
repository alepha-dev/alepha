import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class LintCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  public readonly lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    handler: async ({ root }) => {
      await this.scaffolder.ensureConfig(root, { biomeJson: true });
      await this.pm.ensureDependency(root, "@biomejs/biome", {
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });
      await this.utils.exec("biome check --fix");
    },
  });
}
