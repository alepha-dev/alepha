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

      // The compiler's own diagnostics, through the `tsgolint` binary that
      // `alepha lint` already runs for type-aware rules. `typescript` stays a
      // dependency regardless: `InfraConfigEditor` edits `alepha.config.ts`
      // through its AST API, which spawns the native compiler. Measured against `tsc --noEmit` on 4001 seeded errors across
      // `packages/alepha` and Lore (#Q3073): the same file, line, column and
      // code for every one, as fast or faster, with less memory.
      //
      // One difference, by design: each file is checked under its nearest
      // `tsconfig.json` and reported only when it sits under the directory
      // being checked. `tsc -p` also reports files of other workspaces it
      // reaches through imports, which their own `typecheck` reports anyway.
      //
      // An empty rule set, so that typecheck reports types and nothing else:
      // lint findings are `alepha lint`'s.
      this.utils.useEmbeddedTsgolint();
      const oxlint = this.utils.resolveBin("oxlint");
      const config = await this.utils.writeConfigFile(
        "oxlint-typecheck.json",
        JSON.stringify({ plugins: [], categories: {}, rules: {} }),
        root,
      );
      await run(
        `node "${oxlint}" -c "${config}" --type-aware --type-check --ignore-pattern node_modules`,
        { alias: "typecheck" },
      );
    },
  });
}
