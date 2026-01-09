import { access } from "node:fs/promises";
import { join } from "node:path";
import { $inject, Alepha, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { boot } from "alepha/vite";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class DevCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);
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
    args: t.optional(t.text({ title: "path", description: "Filepath to run" })),
    handler: async ({ args, root }) => {
      const expo = await this.utils.hasExpo(root);

      await this.utils.ensureConfig(root, {
        viteConfigTs: !expo,
        tsconfigJson: true,
      });

      if (expo) {
        await this.utils.exec("expo start");
        return;
      }

      const entry = await boot.getServerEntry(root, args);
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
      await this.utils.ensureDependency(root, "vite");
      await this.utils.exec("vite");
    },
  });

  protected async isBunProject(root: string): Promise<boolean> {
    if (this.alepha.isBun()) {
      return true;
    }
    try {
      await access(join(root, "bun.lock"));
      return true;
    } catch {
      return false;
    }
  }

  protected async isFullstackProject(root: string): Promise<boolean> {
    try {
      await access(join(root, "index.html"));
      return true;
    } catch {
      return false;
    }
  }
}
