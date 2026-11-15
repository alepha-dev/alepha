import { pathToFileURL } from "node:url";

import { $hook, $inject, Alepha, AlephaError, type Service } from "alepha";
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

  protected applyExtension(extension: unknown, path: string): void {
    if (typeof extension !== "function") {
      throw new AlephaError(
        `${path} must default-export a function. Use export default defineConfig({ ... }).`,
      );
    }
    this.alepha.inject(extension as Service, { args: [this.alepha] });
  }

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      await this.loadInfraCommands();
      const argv =
        this.alepha.store.get(cliOptions)?.argv ?? process.argv.slice(2);
      if (!this.loadsConfig(argv)) return;
      const root = process.cwd();
      const extensionPath = this.fs.join(root, "alepha.config.ts");
      const hasExtension = await this.fs.exists(extensionPath);
      if (!hasExtension) {
        return;
      }

      // import (use file:// URL for Windows compatibility)
      const extensionUrl = pathToFileURL(extensionPath).href;
      const { default: Extension } = await import(extensionUrl);
      this.applyExtension(Extension, extensionPath);
    },
  });

  /**
   * Whether this invocation evaluates the project's `alepha.config.ts`.
   *
   * - Not for `alepha init`: init preflights the config's source text itself,
   *   including legacy or dynamic configs, and importing it here would
   *   evaluate it before the bounded edit. Only the ROOT command counts: a
   *   subcommand named `init` (`alepha capacitor init`) belongs to a command a
   *   config plugin declares, and exists only once the config is loaded.
   * - Not for infra help, which is built into the Node CLI and must never
   *   evaluate app config, nor for the bare help screens.
   */
  protected loadsConfig(argv: string[]): boolean {
    const rootCommand = argv[0];
    if (rootCommand === "init") return false;
    const infraHelp = argv.some((arg) => arg === "infra" || arg === "deploy");
    return !(
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
    );
  }
}
