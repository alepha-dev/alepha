import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { getServerEntry } from "@alepha/vite";
import { tsconfigJson } from "../assets/tsconfigJson.ts";
import { viteConfigTs } from "../assets/viteConfigTs.ts";
import { exec, writeConfigFile } from "../helpers/exec.ts";

export class ViteCommands {
  protected readonly log = $logger();

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
    handler: async ({ args, flags }) => {
      await this.ensureTsConfig();
      await exec(`tsx ${flags.watch ? "watch " : ""}${args}`);
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
    handler: async () => {
      const root = process.cwd();
      await this.ensureTsConfig(root);
      const entry = await getServerEntry(root);

      try {
        await access(join(root, "index.html"));
      } catch {
        // check src/**/* in
        await exec(`tsx watch ${entry}`);
        return;
      }

      const configPath = await this.configPath();
      await exec(`vite -c=${configPath}`);
    },
  });

  public readonly build = $command({
    name: "build",
    description: "Build the project for production",
    flags: t.object({
      lib: t.optional(t.boolean()),
      config: t.optional(t.text({ aliases: ["c"] })),
    }),
    handler: async ({ flags }) => {
      await this.ensureTsConfig();

      if (flags.lib) {
        await exec(`tsdown${flags.config ? ` -c=${flags.config}` : ""}`);
        return;
      }

      const configPath = await this.configPath();
      await exec(`vite build -c=${configPath}`);
    },
  });

  public readonly test = $command({
    name: "test",
    description: "Run tests using Vitest",
    handler: async () => {
      await this.ensureTsConfig();

      const configPath = await this.configPath();
      await exec(`vitest run -c=${configPath}`);
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected async ensureTsConfig(root = process.cwd()) {
    const tsconfigPath = join(root, "tsconfig.json");
    try {
      await access(tsconfigPath);
    } catch {
      await writeFile(tsconfigPath, tsconfigJson);
    }
  }

  protected async configPath(root = process.cwd()): Promise<string> {
    try {
      const viteConfigPath = join(root, "vite.config.ts");
      await access(viteConfigPath);
      return viteConfigPath;
    } catch {
      return writeConfigFile("vite.config.ts", viteConfigTs);
    }
  }
}
