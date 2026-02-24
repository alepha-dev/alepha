import { $inject } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";

export class VerifyCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);

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

      const pkg = await this.pm.readPackageJson(root);
      if (pkg.devDependencies?.vitest) {
        await run("alepha test");
      }

      if (await this.utils.exists(root, "migrations")) {
        await run("alepha db migrations check");
      }

      const isExpo = await this.pm.hasExpo(root);
      if (!isExpo) {
        await run("alepha build");
      }
      await run("alepha clean");
    },
  });
}
