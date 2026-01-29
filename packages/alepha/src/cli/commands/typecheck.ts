import { $inject } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class TypecheckCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly log = $logger();
  protected readonly scaffolder = $inject(ProjectScaffolder);

  /**
   * Run TypeScript type checking across the codebase with no emit.
   */
  public readonly typecheck = $command({
    name: "typecheck",
    aliases: ["tc"],
    description: "Check TypeScript types across the codebase",
    handler: async ({ root }) => {
      this.log.info("Starting TypeScript type checking...");

      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
        checkWorkspace: true,
      });

      await this.pm.ensureDependency(root, "typescript", {
        checkWorkspace: true,
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });

      await this.utils.exec("tsc --noEmit");

      this.log.info("TypeScript type checking completed successfully.");
    },
  });
}
