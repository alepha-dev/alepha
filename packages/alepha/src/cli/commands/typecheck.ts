import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class TypecheckCommand {
  protected readonly utils = $inject(AlephaCliUtils);

  /**
   * Run TypeScript type checking across the codebase with no emit.
   */
  public readonly typecheck = $command({
    name: "typecheck",
    description: "Check TypeScript types across the codebase",
    handler: async ({ root }) => {
      await this.utils.ensureDependency(root, "typescript");
      await this.utils.exec("tsc --noEmit");
    },
  });
}
