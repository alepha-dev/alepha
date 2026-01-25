import { $inject, Alepha } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteDevServerProvider } from "../providers/ViteDevServerProvider.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class DevCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly alepha = $inject(Alepha);
  protected readonly viteDevServer = $inject(ViteDevServerProvider);
  protected readonly boot = $inject(AppEntryProvider);

  /**
   * Will run the project in watch mode.
   *
   * - If an index.html file is found in the project root, it will run Vite in dev mode.
   * - Otherwise, it will look for a server entry file and run it with tsx in watch mode.
   */
  public readonly dev = $command({
    name: "dev",
    description: "Run the project in development mode",
    handler: async ({ root }) => {
      const [expo, react] = await Promise.all([
        this.pm.hasExpo(root),
        this.pm.hasReact(root),
      ]);

      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      if (expo) {
        await this.utils.exec("expo start");
        return;
      }

      const entry = await this.boot.getAppEntry(root);
      this.log.debug("Entry file found", { entry });

      // -> here, we assume we use Vite as runner (api or fullstack)
      // but it's planned to support Bun runner in the future as well

      // Ensure vite is installed before running
      await this.pm.ensureDependency(root, "vite", {
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });

      await this.viteDevServer.init({ root, entry });
      await this.viteDevServer.start();
    },
  });
}
