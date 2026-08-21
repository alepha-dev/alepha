import { $inject } from "alepha";
import { $command } from "alepha/command";

import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class LintCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

  public readonly lint = $command({
    name: "lint",
    description: "Lint and format the codebase using oxlint and oxfmt",
    handler: async ({ run, root }) => {
      await this.scaffolder.ensureConfig(root, {
        oxc: true,
        checkWorkspace: true,
      });

      // oxlint and oxfmt ship embedded in `alepha` — resolved and run from
      // alepha's own install, so the project never declares them.
      const oxlint = this.utils.resolveBin("oxlint");
      const oxfmt = this.utils.resolveBin("oxfmt");

      // Lint first, format second, and the order matters: `oxlint --fix`
      // rewrites code (dropping an unused import, unwrapping a useless spread)
      // with no regard for line width, so the formatter has to run afterwards
      // for the tree to end up in a state the next `lint` agrees with. The
      // other order formats, then edits, then reports clean on a file it has
      // just made unformatted.
      //
      // The failure is held rather than thrown, so that a project with one
      // unfixable lint error still gets formatted. Otherwise `lint` leaves the
      // tree half-done and the error it reports is buried under a diff the
      // user did not ask for.
      let unfixed: unknown;
      try {
        await run(`node "${oxlint}" --fix`);
      } catch (error) {
        unfixed = error;
      }

      await run(`node "${oxfmt}"`);

      if (unfixed) {
        throw unfixed;
      }
    },
  });
}
