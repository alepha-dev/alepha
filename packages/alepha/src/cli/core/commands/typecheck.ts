import { $inject } from "alepha";
import { $command } from "alepha/command";

import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class TypecheckCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Run TypeScript type checking across the codebase with no emit.
   */
  public readonly typecheck = $command({
    name: "typecheck",
    aliases: ["tc"],
    description: "Check TypeScript types across the codebase",
    handler: async ({ run, root }) => {
      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
        checkWorkspace: true,
      });

      // TypeScript ships embedded in `alepha` — resolve and run its `tsc`
      // from alepha's own install, so the project never declares it.
      const tsc = this.utils.resolveBin("typescript", "tsc");
      await run(`node "${tsc}" --noEmit`);
    },
  });
}
