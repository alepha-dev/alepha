import { $inject } from "alepha";
import { $command } from "alepha/command";
import { ProcessRunner } from "../services/ProcessRunner.ts";

export class VerifyCommands {
  protected readonly processRunner = $inject(ProcessRunner);

  /**
   * Run a series of verification commands to ensure code quality and correctness.
   *
   * This command runs the following checks in order:
   * 1. Clean the project
   * 2. Format the code
   * 3. Lint the code
   * 4. Run tests
   * 5. Type check the code
   * 8. Build the project
   * 9. Clean the project again
   */
  public readonly verify = $command({
    name: "verify",
    description: "Verify the Alepha project",
    handler: async ({ run }) => {
      await run("alepha clean");
      await run("alepha format");
      await run("alepha lint");
      await run("alepha test");
      await run("alepha typecheck");
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
