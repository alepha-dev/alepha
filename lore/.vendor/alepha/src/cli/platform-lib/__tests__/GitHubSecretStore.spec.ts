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

    test("a 404 reads as an empty store - that environment has none yet", async ({
      expect,
    }) => {
      const { shell, store } = createTestEnv();
      shell.errors.set(
        "gh secret list --env bad-env --json name,updatedAt",
        "HTTP 404: Not Found (https://api.github.com/repos/o/r/environments/bad-env/secrets)",
      );

      const result = await store.list("bad-env");
      expect(result).toEqual([]);
    });

    test("any other failure is raised, never flattened into an empty list", async ({
      expect,
    }) => {
      const { shell, store } = createTestEnv();
      // An empty list is not "unknown": the caller reads it as "no secret is
      // set" and reports a clean state or pushes a duplicate.
      shell.errors.set(
        "gh secret list --env app-production --json name,updatedAt",
        "HTTP 401: Bad credentials",
      );

      await expect(store.list("app-production")).rejects.toThrow(
        "HTTP 401: Bad credentials",
      );
    });
  });

  describe("set", () => {
    test("writes dotenv file and calls gh secret set --env-file", async ({
      expect,
    }) => {
      const { shell, fs, store } = createTestEnv();

      await store.set("app-production", "API_KEY", "abc123");

      // Should write dotenv format
      // Private per-invocation directory (mode 0700), not a guessable
      // /tmp path any local user could read or pre-create.
      const written = fs.writeFileCalls.find((c) =>
        /node_modules\/\.alepha\/secrets\/[0-9a-f-]{36}\/secret\.env$/.test(
          c.path,
        ),
      );
      expect(written?.path).not.toMatch(/^\/tmp\//);
      expect(written).toBeDefined();
      expect(written!.data).toBe('API_KEY="abc123"\n');

      // Should call gh with --env-file (no positional secret name)
      expect(
        shell.wasCalledMatching(
          /gh secret set -f node_modules\/\.alepha\/secrets\/[0-9a-f-]{36}\/secret\.env --env app-production/,
        ),
      ).toBe(true);

      // Temp file should be cleaned up
      expect(
        fs.rmCalls.some((c) =>
          /node_modules\/\.alepha\/secrets\/[0-9a-f-]{36}$/.test(c.path),
        ),
      ).toBe(true);
    });

    test("escapes special characters in value", async ({ expect }) => {
      const { fs, store } = createTestEnv();

      await store.set("app-production", "KEY", 'val"ue\nwith\\special');

      const written = fs.writeFileCalls.find((c) =>
        /secrets\/[0-9a-f-]{36}\/secret\.env$/.test(c.path),
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
