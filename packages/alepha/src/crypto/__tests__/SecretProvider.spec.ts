import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECRET_KEY_VALUE,
  SecretProvider,
} from "../providers/SecretProvider.ts";

describe("SecretProvider", () => {
  it("throws on start in production when APP_SECRET is the default", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "production" } });
    // Register the provider so its `configure` hook runs on start.
    alepha.inject(SecretProvider);

    await expect(alepha.start()).rejects.toThrow(/SecretProvider|APP_SECRET/);
  });

  it("starts in production when APP_SECRET is set to a non-default value", async () => {
    const alepha = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: "a-strong-unique-secret" },
    });
    alepha.inject(SecretProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    await alepha.stop();
  });

  it("only warns (does not throw) outside production with the default secret", async () => {
    const alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    alepha.inject(SecretProvider);

    await expect(alepha.start()).resolves.toBeDefined();
    await alepha.stop();
  });

  describe("APP_SECRET_FILE", () => {
    const SECRET_PATH = "/data/.app_secret";

    const createEnv = (env: Record<string, string>) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", ...env },
      }).with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
      const fs = alepha.inject(MemoryFileSystemProvider);
      const secret = alepha.inject(SecretProvider);
      return { alepha, fs, secret };
    };

    it("generates and persists a secret when the file does not exist", async () => {
      const { alepha, fs, secret } = createEnv({
        APP_SECRET_FILE: SECRET_PATH,
      });

      await alepha.start();

      expect(fs.wasWritten(SECRET_PATH)).toBe(true);
      expect(secret.secretKey).not.toBe(DEFAULT_SECRET_KEY_VALUE);
      expect(secret.secretKey.length).toBeGreaterThanOrEqual(32);
      expect(await fs.readTextFile(SECRET_PATH)).toBe(secret.secretKey);

      await alepha.stop();
    });

    it("writes the generated secret with mode 0600", async () => {
      const { alepha, fs } = createEnv({ APP_SECRET_FILE: SECRET_PATH });

      await alepha.start();

      expect(fs.wasWrittenWithMode(SECRET_PATH, 0o600)).toBe(true);
      expect((await fs.stat(SECRET_PATH)).mode).toBe(0o600);

      await alepha.stop();
    });

    it("returns the same secret on a second boot against the same volume", async () => {
      const first = createEnv({ APP_SECRET_FILE: SECRET_PATH });
      await first.alepha.start();
      const generated = first.secret.secretKey;
      await first.alepha.stop();

      const second = createEnv({ APP_SECRET_FILE: SECRET_PATH });
      // The volume survives the restart; the container does not.
      await second.fs.writeFile(
        SECRET_PATH,
        await first.fs.readTextFile(SECRET_PATH),
      );
      second.fs.writeFileCalls = [];

      await second.alepha.start();

      // A regenerated secret would invalidate every session on restart, and
      // the image would look healthy right up until the operator restarted it.
      expect(second.secret.secretKey).toBe(generated);
      // Nothing rewritten: the second boot read the file it found.
      expect(second.fs.wasWritten(SECRET_PATH)).toBe(false);

      await second.alepha.stop();
    });

    it("uses an existing file's contents verbatim", async () => {
      const { alepha, fs, secret } = createEnv({
        APP_SECRET_FILE: SECRET_PATH,
      });
      await fs.writeFile(SECRET_PATH, "  a-secret-from-disk\n");

      await alepha.start();

      expect(secret.secretKey).toBe("a-secret-from-disk");

      await alepha.stop();
    });

    it("lets an explicit APP_SECRET beat a file holding something else", async () => {
      const { alepha, fs, secret } = createEnv({
        APP_SECRET_FILE: SECRET_PATH,
        APP_SECRET: "an-explicit-secret",
      });
      await fs.writeFile(SECRET_PATH, "a-secret-from-disk");

      await alepha.start();

      expect(secret.secretKey).toBe("an-explicit-secret");

      await alepha.stop();
    });

    it("refuses the file path on serverless rather than ignoring it", async () => {
      const { alepha } = createEnv({
        APP_SECRET_FILE: SECRET_PATH,
        ALEPHA_SERVERLESS: "true",
      });

      // A silent no-op here would leave a Worker booting on the public default.
      await expect(alepha.start()).rejects.toThrow(
        /APP_SECRET_FILE.*serverless/s,
      );
    });

    it("still throws in production when APP_SECRET_FILE is unset", async () => {
      const { alepha } = createEnv({});

      await expect(alepha.start()).rejects.toThrow(/APP_SECRET/);
    });
  });
});
