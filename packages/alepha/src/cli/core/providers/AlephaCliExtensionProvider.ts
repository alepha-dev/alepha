import { pathToFileURL } from "node:url";
import { $hook, $inject, Alepha } from "alepha";
import { FileSystemProvider } from "alepha/system";

export class AlephaCliExtensionProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
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
