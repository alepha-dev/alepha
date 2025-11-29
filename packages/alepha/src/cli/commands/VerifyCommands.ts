import { $inject } from "alepha";
import { $command } from "alepha/command";
import { ProcessRunner } from "../services/ProcessRunner.ts";
import { ProjectUtils } from "../services/ProjectUtils.ts";

export class VerifyCommands {
  protected readonly processRunner = $inject(ProcessRunner);
  protected readonly utils = $inject(ProjectUtils);

  /**
   * Run a series of verification commands to ensure code quality and correctness.
   *
   * This command runs the following checks in order:
   * - Clean the project
   * - Format the code
   * - Lint the code
   * - Run tests (if Vitest is a dev dependency)
   * - Check database migrations (if a migrations directory exists)
   * - Type check the code
   * - Build the project
   * - Clean the project again
   */
  public readonly verify = $command({
    name: "verify",
    description: "Verify the Alepha project",
    handler: async ({ root, run }) => {
      await run("alepha clean");
      await run("alepha format");
      await run("alepha lint");

      await run("alepha typecheck");

      const pkg = await this.utils.readPackageJson(root);
      if (pkg.devDependencies?.vitest) {
        await run("alepha test");
      }

      if (await this.utils.hasDir(root, "migrations")) {
        await run("alepha db:migrate:check");
      }

      await run("alepha build");
      await run("alepha clean");
    },
  });

  /**
   * Run TypeScript type checking across the codebase with no emit.
   */
  public readonly typecheck = $command({
    name: "typecheck",
    description: "Check TypeScript types across the codebase",
    handler: async () => {
      await this.processRunner.exec("tsc --noEmit");
    },
  });
}
