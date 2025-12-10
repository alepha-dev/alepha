import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class VerifyCommands {
  protected readonly utils = $inject(AlephaCliUtils);

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

      if (await this.utils.exists(root, "migrations")) {
        await run("alepha db:check-migrations");
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
    handler: async ({ root }) => {
      await this.utils.ensureDependency(root, "typescript");
      await this.utils.exec("tsc --noEmit");
    },
  });
}
