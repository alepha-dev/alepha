import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class LintCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  public readonly lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    handler: async ({ run, root }) => {
      await this.scaffolder.ensureConfig(root, {
        biomeJson: true,
        checkWorkspace: true,
      });

      // Biome ships embedded in `alepha` — resolve and run it from alepha's
      // own install, so the project never declares it.
      const biome = this.utils.resolveBin("@biomejs/biome", "biome");
      await run(`node "${biome}" check --fix`);
    },
  });
}
