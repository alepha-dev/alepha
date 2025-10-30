import { access } from "node:fs/promises";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { biomeJson } from "../assets/biomeJson.ts";
import { exec, writeConfigFile } from "../helpers/exec.ts";

export class BiomeCommands {
  protected readonly log = $logger();
  protected readonly biomeFlags = t.object({
    config: t.optional(
      t.text({
        aliases: ["c"],
      }),
    ),
  });

  public readonly format = $command({
    name: "format",
    description: "Format the codebase using Biome",
    flags: this.biomeFlags,
    handler: async ({ flags }) => {
      const configPath = await this.configPath(flags.config);
      await exec(`biome format --fix --config-path=${configPath}`);
    },
  });

  public readonly lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    flags: this.biomeFlags,
    handler: async ({ flags }) => {
      const configPath = await this.configPath(flags.config);
      await exec(
        `biome check --formatter-enabled=false --fix --config-path=${configPath}`,
      );
    },
  });

  protected async configPath(maybePath?: string): Promise<string> {
    const root = process.cwd();
    if (maybePath) {
      try {
        const path = join(root, maybePath);
        await access(path);
        return path;
      } catch {}
    }

    try {
      const path = join(root, "biome.json");
      await access(path);
      return path;
    } catch {
      return await writeConfigFile("biome.json", biomeJson);
    }
  }
}
