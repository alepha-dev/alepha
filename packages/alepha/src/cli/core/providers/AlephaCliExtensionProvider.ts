import { pathToFileURL } from "node:url";

import { $hook, $inject, Alepha } from "alepha";
import { cliOptions } from "alepha/command";
import { FileSystemProvider } from "alepha/system";

export class AlephaCliExtensionProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Load the built-in Node commands before reading app configuration or help.
   * A dynamic module edge keeps command-free build services usable from an
   * adapter without a constant-initialization cycle through the CLI barrel.
   */
  protected async loadInfraCommands(): Promise<void> {
    const { AlephaCliInfraCommands } = await import("alepha/cli/infra");
    this.alepha.with(AlephaCliInfraCommands);
  }

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      await this.loadInfraCommands();
      const argv =
        this.alepha.store.get(cliOptions)?.argv ?? process.argv.slice(2);
      // Infra help is built into the Node CLI and must never evaluate app config.
      const rootCommand = argv[0];
      // Init preflights source text itself, including legacy or dynamic configs.
      // Importing that config here would evaluate it before the bounded edit.
      if (argv.includes("init")) return;
      const infraHelp = argv.some((arg) => arg === "infra" || arg === "deploy");
      if (
        (rootCommand === "infra" && argv.length === 1) ||
        ((infraHelp ||
          rootCommand === "help" ||
          !rootCommand ||
          rootCommand === "--help" ||
          rootCommand === "-h") &&
          (!rootCommand ||
            argv.some(
              (arg) => arg === "--help" || arg === "-h" || arg === "help",
            )))
      )
        return;
      const root = process.cwd();
      const extensionPath = this.fs.join(root, "alepha.config.ts");
      const hasExtension = await this.fs.exists(extensionPath);
      if (!hasExtension) {
        return;
      }

      // import (use file:// URL for Windows compatibility)
      const extensionUrl = pathToFileURL(extensionPath).href;
      const { default: Extension } = await import(extensionUrl);
      if (typeof Extension !== "function") {
        return;
      }

      this.alepha.inject(Extension, {
        args: [this.alepha],
      });
    },
  });
}
