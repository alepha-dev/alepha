import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { boot } from "alepha/vite";
import { ProcessRunner } from "../services/ProcessRunner.ts";
import { ProjectUtils } from "../services/ProjectUtils.ts";

export class ViteCommands {
  protected readonly log = $logger();
  protected readonly runner = $inject(ProcessRunner);
  protected readonly utils = $inject(ProjectUtils);

  public readonly run = $command({
    name: "run",
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
      await this.runner.exec(`tsx ${flags.watch ? "watch " : ""}${args}`);
    },
  });

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
      await this.utils.ensureTsConfig(root);
      await this.utils.ensurePackageJsonModule(root);
      const entry = await boot.getServerEntry(root, args);
      this.log.trace("Entry file found", { entry });

      try {
        await access(join(root, "index.html"));
      } catch {
        this.log.trace("No index.html found, running entry file with tsx");
        await this.runner.exec(`tsx watch ${entry}`);
        return;
      }

      const configPath = await this.utils.getViteConfigPath(
        root,
        args ? entry : undefined,
      );
      this.log.trace("Vite config found", { configPath });
      await this.runner.exec(`vite -c=${configPath}`);
    },
  });

  public readonly build = $command({
    name: "build",
    description: "Build the project for production",
    args: t.optional(
      t.text({ title: "path", description: "Filepath to build" }),
    ),
    flags: t.object({
      config: t.optional(
        t.text({ aliases: ["c"], description: "Path to config file" }),
      ),
      stats: t.optional(
        t.boolean({
          description: "Generate build stats report",
        }),
      ),
    }),
    handler: async ({ flags, args }) => {
      const root = process.cwd();
      await this.utils.ensureTsConfig(root);
      await this.utils.ensurePackageJsonModule(root);
      const entry = await boot.getServerEntry(root, args);
      this.log.trace("Entry file found", { entry });

      await rm("dist", { recursive: true, force: true });

      // DISABLED FOR NOW (waiting for vite-rolldown)
      // if (flags.lib) {
      //   await this.runner.exec(
      //     `tsdown${flags.config ? ` -c=${flags.config}` : ""}`,
      //   );
      //   return;
      // }

      const configPath = await this.utils.getViteConfigPath(
        root,
        args ? entry : undefined,
      );

      const env: Record<string, string> = {};
      if (flags.stats) {
        env.ALEPHA_BUILD_STATS = "true";
      }

      await this.runner.exec(`vite build -c=${configPath}`, env);
    },
  });

  public readonly test = $command({
    name: "test",
    description: "Run tests using Vitest",
    handler: async ({ root }) => {
      await this.utils.ensureTsConfig(root);
      const configPath = await this.utils.getViteConfigPath(root);
      await this.runner.exec(`vitest run -c=${configPath}`);
    },
  });
}
