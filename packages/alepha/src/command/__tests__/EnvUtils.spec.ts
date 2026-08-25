import { Alepha, z } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, describe, expect, it } from "vitest";

import { EnvUtils } from "../helpers/EnvUtils.ts";
import { $command } from "../primitives/$command.ts";
import { CliProvider } from "../providers/CliProvider.ts";

/**
 * Exposes the production execution path, the only one that loads env files.
 * `CliProvider.run()` deliberately skips them.
 */
class TestCliProvider extends CliProvider {
  public testExecuteCommand = this.executeCommand.bind(this);
}

describe("EnvUtils", () => {
  describe("parseEnv", () => {
    it("should strip double quotes from values", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/.env", 'FOO="bar"\n');

      const envUtils = alepha.inject(EnvUtils);
      const result = await envUtils.parseEnv("/project");

      expect(result.FOO).toBe("bar");
    });

    it("should strip single quotes from values", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/.env", "FOO='bar'\n");

      const envUtils = alepha.inject(EnvUtils);
      const result = await envUtils.parseEnv("/project");

      expect(result.FOO).toBe("bar");
    });

    it("should preserve values without quotes", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/.env", "FOO=bar\n");

      const envUtils = alepha.inject(EnvUtils);
      const result = await envUtils.parseEnv("/project");

      expect(result.FOO).toBe("bar");
    });

    it("should preserve values with equals signs in quoted strings", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile(
        "/project/.env",
        'DATABASE_URL="postgres://user:pass@host/db?sslmode=require"\n',
      );

      const envUtils = alepha.inject(EnvUtils);
      const result = await envUtils.parseEnv("/project");

      expect(result.DATABASE_URL).toBe(
        "postgres://user:pass@host/db?sslmode=require",
      );
    });

    it("should not strip mismatched quotes", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/.env", "FOO=\"bar'\n");

      const envUtils = alepha.inject(EnvUtils);
      const result = await envUtils.parseEnv("/project");

      expect(result.FOO).toBe("\"bar'");
    });

    it("should not strip quotes from single-character values", async () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.writeFile("/project/.env", 'FOO="\n');

      const envUtils = alepha.inject(EnvUtils);
      const result = await envUtils.parseEnv("/project");

      expect(result.FOO).toBe('"');
    });
  });

  describe("--mode wiring", () => {
    afterEach(() => {
      for (const key of Object.keys(process.env)) {
        if (key.startsWith("ENV_UTILS_SPEC_")) {
          delete process.env[key];
        }
      }
    });

    const create = () => {
      class App {
        dev = $command({
          name: "dev",
          mode: true,
          flags: z.object({}),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      return {
        cli: alepha.inject(TestCliProvider),
        fs: alepha.inject(MemoryFileSystemProvider),
        command: alepha.inject(App).dev,
      };
    };

    it("should load .env.<mode> on top of .env", async () => {
      const { cli, fs, command } = create();
      const root = process.cwd();
      await fs.writeFile(`${root}/.env`, "ENV_UTILS_SPEC_BASE=base\n");
      await fs.writeFile(
        `${root}/.env.staging`,
        "ENV_UTILS_SPEC_STAGING=yes\n",
      );

      await cli.testExecuteCommand(command, ["--mode", "staging"], true);

      expect(process.env.ENV_UTILS_SPEC_BASE).toBe("base");
      expect(process.env.ENV_UTILS_SPEC_STAGING).toBe("yes");
    });

    it("should leave .env.<mode> alone without the flag", async () => {
      const { cli, fs, command } = create();
      const root = process.cwd();
      await fs.writeFile(`${root}/.env`, "ENV_UTILS_SPEC_BASE=base\n");
      await fs.writeFile(
        `${root}/.env.staging`,
        "ENV_UTILS_SPEC_STAGING=yes\n",
      );

      await cli.testExecuteCommand(command, [], true);

      expect(process.env.ENV_UTILS_SPEC_BASE).toBe("base");
      expect(process.env.ENV_UTILS_SPEC_STAGING).toBeUndefined();
    });

    it("should hand the mode to the handler", async () => {
      let seen: string | undefined;

      class App {
        deploy = $command({
          name: "deploy",
          mode: "production",
          flags: z.object({}),
          handler: async ({ mode }) => {
            seen = mode;
          },
        });
      }

      const alepha = Alepha.create()
        .with(App)
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
      const cli = alepha.inject(TestCliProvider);

      await cli.testExecuteCommand(alepha.inject(App).deploy, [], true);
      expect(seen).toBe("production");

      await cli.testExecuteCommand(
        alepha.inject(App).deploy,
        ["--mode", "staging"],
        true,
      );
      expect(seen).toBe("staging");
    });
  });
});
