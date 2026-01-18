import { $inject, Alepha } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { boot, devServer } from "alepha/vite";
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
      const expo = await this.pm.hasExpo(root);

      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      if (expo) {
        await this.utils.exec("expo start");
        return;
      }

      const entry = await boot.getServerEntry(root);
      this.log.trace("Entry file found", { entry });

      const isFullstack = await this.isFullstackProject(root);

      if (!isFullstack) {
        const exe = (await this.isBunProject(root)) ? "bun" : "tsx";
        let cmd = `${exe} --watch`;
        if (await this.utils.exists(root, ".env")) {
          cmd += " --env-file=./.env";
        }
        cmd += ` ${entry}`;
        await this.utils.exec(cmd, {
          global: exe === "bun",
        });
        return;
      }

      // Ensure vite is installed before running
      await this.pm.ensureDependency(root, "vite", {
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });

      await devServer();
    },
  });

  protected async isBunProject(root: string): Promise<boolean> {
    if (this.alepha.isBun()) {
      return true;
    }
    return this.fs.exists(this.fs.join(root, "bun.lock"));
  }

  protected async isFullstackProject(root: string): Promise<boolean> {
    return this.fs.exists(this.fs.join(root, "index.html"));
  }
}
