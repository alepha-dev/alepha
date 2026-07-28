import { $state } from "alepha";
import { $command } from "alepha/command";
import { buildOptions } from "../atoms/buildOptions.ts";

export class CleanCommand {
  protected readonly options = $state(buildOptions);

  /**
   * Clean the project, removing the build output directory.
   */
  public readonly clean = $command({
    name: "clean",
    description: "Clean the project",
    handler: async ({ run }) => {
      // `./dist` was hardcoded, so a project configuring `output.dist` got a
      // no-op clean and stale artifacts survived into the next build.
      const distDir = this.options.output?.dist ?? "dist";
      await run.rm(`./${distDir}`);
    },
  });
}
