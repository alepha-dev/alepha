import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { EnvUtils } from "./EnvUtils.ts";

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
});
