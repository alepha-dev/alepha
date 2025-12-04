import { join } from "node:path";
import { $hook, $inject, $module, Alepha } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { BiomeCommands } from "../commands/BiomeCommands.ts";
import { CoreCommands } from "../commands/CoreCommands.ts";
import { DrizzleCommands } from "../commands/DrizzleCommands.ts";
import { VerifyCommands } from "../commands/VerifyCommands.ts";
import { ViteCommands } from "../commands/ViteCommands.ts";
import { ProcessRunner } from "../services/ProcessRunner.ts";

class AlephaCliExtension {
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      const extensionPath = join(process.cwd(), "alepha.config.ts");
      const hasExtension = await this.fs.exists(extensionPath);
      if (!hasExtension) {
        return;
      }

      // import
      const { default: Extension } = await import(extensionPath);
      if (typeof Extension !== "function") {
        return;
      }

      this.alepha.with(Extension);
    },
  });
}

export const AlephaCli = $module({
  name: "alepha.cli",
  services: [
    AlephaCliExtension,
    ProcessRunner,
    CoreCommands,
    DrizzleCommands,
    VerifyCommands,
    ViteCommands,
    BiomeCommands,
  ],
});
