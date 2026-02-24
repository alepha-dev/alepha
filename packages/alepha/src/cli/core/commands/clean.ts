import { $command } from "alepha/command";

export class CleanCommand {
  /**
   * Clean the project, removing the "dist" directory
   */
  public readonly clean = $command({
    name: "clean",
    description: "Clean the project",
    handler: async ({ run }) => {
      await run.rm("./dist");
    },
  });
}
