import { $inject, $use, Alepha, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { devOptions } from "../atoms/devOptions.ts";
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
  protected readonly options = $use(devOptions);

  /**
   * Will run the project in watch mode.
   */
  public readonly dev = $command({
    name: "dev",
    mode: true,
    description: "Run the project in development mode",
    flags: t.object({
      "no-devtools": t.optional(
        t.boolean({
          description: "Disable devtools",
        }),
      ),
      "no-vite-react-plugin": t.optional(
        t.boolean({
          description: "Disable Vite React plugin",
        }),
      ),
    }),
    handler: async ({ root, flags }) => {
      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      const entry = await this.boot.getAppEntry(root);
      this.log.debug("Entry file found", { entry });

      const options = this.options;

      // -> here, we assume we use Vite as runner (api or fullstack)
      // but it's planned to support Bun runner in the future as well
      await this.viteDevServer.init({
        root,
        entry,
        noDevtools: flags["no-devtools"] ?? options.noDevtools ?? false,
        noViteReactPlugin:
          flags["no-vite-react-plugin"] ?? options.noViteReactPlugin ?? false,
      });
      await this.viteDevServer.start();
    },
  });
}
