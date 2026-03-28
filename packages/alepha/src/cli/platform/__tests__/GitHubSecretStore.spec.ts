import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import { GitHubSecretStore } from "../providers/GitHubSecretStore.ts";

describe("GitHubSecretStore", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({
        provide: ShellProvider,
        use: MemoryShellProvider,
      })
      .with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });

    const shell = alepha.inject(MemoryShellProvider);
    const fs = alepha.inject(MemoryFileSystemProvider);
    const store = alepha.inject(GitHubSecretStore);

    return { alepha, shell, fs, store };
  };

  describe("ensureAvailable", () => {
    test("succeeds when gh is installed and authenticated", async ({
      expect,
    }) => {
      const { shell, store } = createTestEnv();
      shell.installedCommands.add("gh");
      shell.outputs.set("gh auth status", "Logged in");

      await expect(store.ensureAvailable()).resolves.not.toThrow();
    });

    test("throws when gh is not installed", async ({ expect }) => {
      const { store } = createTestEnv();

      await expect(store.ensureAvailable()).rejects.toThrow(
        "GitHub CLI (gh) is not installed",
      );
    });

    test("throws when gh is not authenticated", async ({ expect }) => {
      const { shell, store } = createTestEnv();
      shell.installedCommands.add("gh");
      shell.errors.set("gh auth status", "Not logged in");

      await expect(store.ensureAvailable()).rejects.toThrow(
        "GitHub CLI is not authenticated",
      );
    });
  });

  describe("list", () => {
    test("parses JSON output from gh", async ({ expect }) => {
      const { shell, store } = createTestEnv();
      shell.outputs.set(
        "gh secret list --env app-production --json name,updatedAt",
        JSON.stringify([
          { name: "API_KEY", updatedAt: "2026-01-01T00:00:00Z" },
          { name: "DATABASE_URL", updatedAt: "2026-01-02T00:00:00Z" },
        ]),
      );

      const result = await store.list("app-production");

      expect(result).toEqual([
        { name: "API_KEY", updatedAt: "2026-01-01T00:00:00Z" },
        { name: "DATABASE_URL", updatedAt: "2026-01-02T00:00:00Z" },
      ]);
    });

    test("returns empty array when no secrets", async ({ expect }) => {
      const { shell, store } = createTestEnv();
      shell.outputs.set(
        "gh secret list --env app-staging --json name,updatedAt",
        "[]",
      );

      const result = await store.list("app-staging");
      expect(result).toEqual([]);
    });

    test("returns empty array on error", async ({ expect }) => {
      const { shell, store } = createTestEnv();
      shell.errors.set(
        "gh secret list --env bad-env --json name,updatedAt",
        "Environment not found",
      );

      const result = await store.list("bad-env");
      expect(result).toEqual([]);
    });
  });

  describe("set", () => {
    test("writes dotenv file and calls gh secret set --env-file", async ({
      expect,
    }) => {
      const { shell, fs, store } = createTestEnv();

      await store.set("app-production", "API_KEY", "abc123");

      // Should write dotenv format
      const written = fs.writeFileCalls.find((c) =>
        /\/tmp\/alepha-secret-API_KEY-/.test(c.path),
      );
      expect(written).toBeDefined();
      expect(written!.data).toBe('API_KEY="abc123"\n');

      // Should call gh with --env-file (no positional secret name)
      expect(
        shell.wasCalledMatching(
          /gh secret set -f \/tmp\/alepha-secret-API_KEY-\d+ --env app-production/,
        ),
      ).toBe(true);

      // Temp file should be cleaned up
      expect(
        fs.rmCalls.some((c) => /\/tmp\/alepha-secret-API_KEY-/.test(c.path)),
      ).toBe(true);
    });

    test("escapes special characters in value", async ({ expect }) => {
      const { fs, store } = createTestEnv();

      await store.set("app-production", "KEY", 'val"ue\nwith\\special');

      const written = fs.writeFileCalls.find((c) =>
        /\/tmp\/alepha-secret-KEY-/.test(c.path),
      );
      expect(written!.data).toBe('KEY="val\\"ue\\nwith\\\\special"\n');
    });
  });

  describe("delete", () => {
    test("calls gh secret delete with correct args", async ({ expect }) => {
      const { shell, store } = createTestEnv();

      await store.delete("app-production", "OLD_KEY");

      expect(
        shell.wasCalled("gh secret delete OLD_KEY --env app-production"),
      ).toBe(true);
    });
  });
});
