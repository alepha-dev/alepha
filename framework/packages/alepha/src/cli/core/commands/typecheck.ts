import { $inject, Alepha, type State } from "alepha";
import { $command } from "alepha/command";

import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class TypecheckCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly alepha = $inject(Alepha);

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
      // `alepha lint` already runs for type-aware rules: one embedded build of
      // the TypeScript 7 checker instead of two (#Q3085 removed the last other
      // user of `typescript`, about 30 MB). Measured against `tsc --noEmit` on 4001 seeded errors across
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
      // ⚠️ The vendored packages are skipped like `node_modules`. They carry
      // their own monorepo's configs (a `vitest.config.ts` importing
      // `../../scripts/`), which only resolve upstream, and the generated
      // config above means the project's own `ignorePatterns`, where
      // `alepha lint` learns to skip them, never apply here (#Q3310). Their
      // code is still checked wherever the project imports it.
      //
      // The `vendor()` options are read by their atom's key: `alepha/cli/vendor`
      // imports `alepha/cli`, so importing the atom here would be a cycle.
      const vendor = this.alepha.store.get(
        "alepha.cli.vendor.options" as keyof State,
      ) as { dir?: string } | undefined;
      const ignores = ["node_modules"];
      if (vendor) {
        ignores.push(`${vendor.dir ?? ".vendor"}/**`);
      }
      await run(
        `node "${oxlint}" -c "${config}" --type-aware --type-check ${ignores.map((it) => `--ignore-pattern "${it}"`).join(" ")}`,
        { alias: "typecheck" },
      );
    },
  });
}
