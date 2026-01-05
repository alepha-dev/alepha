import { $inject } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class TypecheckCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly log = $logger();

  /**
   * Run TypeScript type checking across the codebase with no emit.
   */
  public readonly typecheck = $command({
    name: "typecheck",
    aliases: ["tc"],
    description: "Check TypeScript types across the codebase",
    handler: async ({ root }) => {
      this.log.info("Starting TypeScript type checking...");
      await this.utils.ensureDependency(root, "typescript");
      await this.utils.exec("tsc --noEmit");
      this.log.info("TypeScript type checking completed successfully.");
    },
  });
}
