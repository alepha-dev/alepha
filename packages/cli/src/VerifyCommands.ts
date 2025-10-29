import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $command, CliProvider } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { exec } from "./exec.ts";

export class VerifyCommands {
  log = $logger();
  cli = $inject(CliProvider);

  biomeFlags = t.object({
    config: t.optional(
      t.text({
        aliases: ["c"],
      }),
    ),
  });

  verify = $command({
    name: "verify",
    description: "Verify the Alepha project",
    handler: async ({ run }) => {
      await run("alepha clean");
      await run("alepha format");
      await run("alepha lint");
      await run("alepha test");
      await run("alepha typecheck");
      await run("alepha depcheck");
      await run("alepha db:check-migrations");
      await run("alepha build");
      await run("alepha clean");
    },
  });

  format = $command({
    name: "format",
    description: "Format the codebase using Biome",
    flags: this.biomeFlags,
    handler: async ({ flags }) => {
      const configPath = await this.biomeConfigPath(flags.config);
      await exec(`biome format --fix --config-path=${configPath}`);
    },
  });

  lint = $command({
    name: "lint",
    description: "Run linter across the codebase using Biome",
    flags: this.biomeFlags,
    handler: async ({ flags }) => {
      const configPath = await this.biomeConfigPath(flags.config);
      await exec(
        `biome check --formatter-enabled=false --fix --config-path=${configPath}`,
      );
    },
  });

  test = $command({
    name: "test",
    description: "Run tests using Vitest",
    handler: async () => {
      await exec("vitest run");
    },
  });

  typecheck = $command({
    name: "typecheck",
    description: "Check TypeScript types across the codebase",
    handler: async () => {
      await exec("tsc --noEmit");
    },
  });

  depcheck = $command({
    name: "depcheck",
    description: "Check for unused or missing dependencies using Depcheck",
    handler: async () => {
      await exec(
        "depcheck --ignores=jsdom,@alepha/testing,@alepha/cli --ignore-patterns=dist,assets",
      );
    },
  });
  // -------------------------------------------------------------------------------------------------------------------

  async biomeConfigPath(maybePath?: string): Promise<string> {
    if (maybePath) {
      try {
        await access(join(process.cwd(), maybePath));
        return join(process.cwd(), maybePath);
      } catch {}
    }

    try {
      const projectBiomeConfig = join(process.cwd(), "biome.json");
      await access(projectBiomeConfig);
      return projectBiomeConfig;
    } catch {
      const alephaBiomeConfig = join(
        process.cwd(),
        "node_modules",
        ".alepha",
        "biome.json",
      );
      await mkdir(join(process.cwd(), "node_modules", ".alepha"), {
        recursive: true,
      }).catch(() => null);
      await writeFile(
        alephaBiomeConfig,
        JSON.stringify(
          {
            $schema: "https://biomejs.dev/schemas/latest/schema.json",
            vcs: {
              enabled: true,
              clientKind: "git",
            },
            files: {
              ignoreUnknown: true,
              includes: ["**", "!node_modules", "!dist"],
            },
            formatter: {
              enabled: true,
            },
            linter: {
              enabled: true,
              rules: {
                recommended: true,
              },
              domains: {
                react: "recommended",
              },
            },
            assist: {
              actions: {
                source: {
                  organizeImports: "on",
                },
              },
            },
          },
          null,
          2,
        ),
      );
      return alephaBiomeConfig;
    }
  }
}
