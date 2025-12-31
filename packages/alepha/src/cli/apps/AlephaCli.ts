import { join } from "node:path";
import { $hook, $inject, $module, Alepha } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { BiomeCommands } from "../commands/BiomeCommands.ts";
import { ChangelogCommands } from "../commands/ChangelogCommands.ts";
import { CoreCommands } from "../commands/CoreCommands.ts";
import { DeployCommands } from "../commands/DeployCommands.ts";
import { DrizzleCommands } from "../commands/DrizzleCommands.ts";
import { VerifyCommands } from "../commands/VerifyCommands.ts";
import { ViteCommands } from "../commands/ViteCommands.ts";

class AlephaCliExtension {
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      const root = process.cwd();
      const extensionPath = join(root, "alepha.config.ts");
      const hasExtension = await this.fs.exists(extensionPath);
      if (!hasExtension) {
        return;
      }

      // import
      const { default: Extension } = await import(extensionPath);
      if (typeof Extension !== "function") {
        return;
      }

      this.alepha.inject(Extension, {
        args: [this.alepha],
      });
    },
  });
}

export const AlephaCli = $module({
  name: "alepha.cli",
  services: [
    AlephaCliExtension,
    BiomeCommands,
    ChangelogCommands,
    CoreCommands,
    DeployCommands,
    DrizzleCommands,
    VerifyCommands,
    ViteCommands,
  ],
});
