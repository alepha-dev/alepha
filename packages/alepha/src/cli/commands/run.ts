import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class RunCommand {
  protected readonly utils = $inject(AlephaCliUtils);

  public readonly run = $command({
    name: "run",
    hide: true,
    description: "Run a TypeScript file directly",
    flags: t.object({
      watch: t.optional(
        t.boolean({ description: "Watch file for changes", alias: "w" }),
      ),
    }),
    summary: false,
    args: t.text({ title: "path", description: "Filepath to run" }),
    handler: async ({ args, flags, root }) => {
      await this.utils.ensureTsConfig(root);
      await this.utils.exec(`tsx ${flags.watch ? "watch " : ""}${args}`);
    },
  });
}
