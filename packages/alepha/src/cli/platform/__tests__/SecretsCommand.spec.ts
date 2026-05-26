import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";
import { platformOptions } from "../atoms/platformOptions.ts";
import { SecretsCommand } from "../commands/SecretsCommand.ts";
import { MemorySecretStore } from "../providers/MemorySecretStore.ts";
import type { SecretStoreProvider } from "../providers/SecretStoreProvider.ts";

class TestSecretsCommand extends SecretsCommand {
  public readonly testList = this.list;
  public readonly testDiff = this.diff;
  public readonly testApply = this.apply;
  public testStore: MemorySecretStore | null = null;

  public override resolveStore(): SecretStoreProvider {
    if (this.testStore) return this.testStore;
    return super.resolveStore();
  }
}

describe("SecretsCommand", () => {
  const createTestEnv = (
    config: Record<string, any> = {},
    storeSecrets: Record<string, Record<string, string>> = {},
  ) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const store = new MemorySecretStore();
    const cli = alepha.inject(CliProvider);
    const cmd = alepha.inject(TestSecretsCommand);
    cmd.testStore = store;

    alepha.set(platformOptions, {
      name: "my-app",
      environments: { production: { adapter: "cloudflare" } },
      ...config,
    } as any);

    // Seed package.json
    fs.writeFile("/project/package.json", JSON.stringify({ name: "my-app" }));

    // Seed store with pre-existing secrets
    for (const [env, secrets] of Object.entries(storeSecrets)) {
      const envMap = new Map<string, string>();
      for (const [k, v] of Object.entries(secrets)) {
        envMap.set(k, v);
      }
      store.secrets.set(env, envMap);
    }

    return { alepha, fs, store, cli, cmd };
  };

  // -----------------------------------------------------------------------
  // apply
  // -----------------------------------------------------------------------

  describe("apply", () => {
    test("filters and pushes secrets to store", async ({ expect }) => {
      const { fs, store, cli, cmd } = createTestEnv();

      await fs.writeFile(
        "/project/.env.production",
        "DATABASE_URL=postgres://localhost/db\nAPI_KEY=abc123\nNODE_ENV=production\nVITE_APP=hello\nEMPTY=",
      );

      await cli.run(cmd.testApply, {
        root: "/project",
        argv: "--env production",
      });

      expect(store.wasSet("my-app-production", "DATABASE_URL")).toBe(true);
      expect(store.wasSet("my-app-production", "API_KEY")).toBe(true);
      expect(store.wasSet("my-app-production", "NODE_ENV")).toBe(false);
      expect(store.wasSet("my-app-production", "VITE_APP")).toBe(false);
      expect(store.wasSet("my-app-production", "EMPTY")).toBe(false);
    });

    test("renames GITHUB_ keys with APP_ prefix", async ({ expect }) => {
      const { fs, store, cli, cmd } = createTestEnv();

      await fs.writeFile(
        "/project/.env.production",
        "GITHUB_CLIENT_ID=id123\nGITHUB_CLIENT_SECRET=secret456",
      );

      await cli.run(cmd.testApply, {
        root: "/project",
        argv: "--env production",
      });

      expect(store.wasSet("my-app-production", "APP_GITHUB_CLIENT_ID")).toBe(
        true,
      );
      expect(
        store.wasSet("my-app-production", "APP_GITHUB_CLIENT_SECRET"),
      ).toBe(true);
      expect(store.wasSet("my-app-production", "GITHUB_CLIENT_ID")).toBe(false);
    });

    test("dry run does not call store", async ({ expect }) => {
      const { fs, store, cli, cmd } = createTestEnv();

      await fs.writeFile(
        "/project/.env.production",
        "API_KEY=abc123\nSECRET=xyz",
      );

      await cli.run(cmd.testApply, {
        root: "/project",
        argv: "--env production --dry-run",
      });

      expect(store.calls.filter((c) => c.method === "set")).toHaveLength(0);
    });

    test("uses custom environment pattern", async ({ expect }) => {
      const { fs, store, cli, cmd } = createTestEnv({
        secrets: {
          store: "github",
          environmentPattern: "{env}",
        },
      });

      await fs.writeFile("/project/.env.production", "API_KEY=abc123");

      await cli.run(cmd.testApply, {
        root: "/project",
        argv: "--env production",
      });

      expect(store.wasSet("production", "API_KEY")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // diff
  // -----------------------------------------------------------------------

  describe("diff", () => {
    test("detects only-local, only-remote, and in-both keys", async ({
      expect,
    }) => {
      const { fs, cli, cmd } = createTestEnv(
        {},
        {
          "my-app-production": {
            API_KEY: "remote-value",
            OLD_SECRET: "stale",
          },
        },
      );

      await fs.writeFile(
        "/project/.env.production",
        "API_KEY=local-value\nNEW_SECRET=fresh",
      );

      // Capture stdout
      const writes: string[] = [];
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => {
        writes.push(chunk);
        return true;
      }) as any;

      try {
        await cli.run(cmd.testDiff, {
          root: "/project",
          argv: "--env production",
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes
      const output = writes.join("").replace(/\x1B\[[0-9;]*m/g, "");
      expect(output).toContain("+ NEW_SECRET");
      expect(output).toContain("- OLD_SECRET");
      expect(output).toContain("= API_KEY");
    });
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  describe("list", () => {
    test("shows table format by default", async ({ expect }) => {
      const { cli, cmd } = createTestEnv(
        {},
        {
          "my-app-production": {
            API_KEY: "value1",
            DATABASE_URL: "value2",
          },
        },
      );

      const writes: string[] = [];
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => {
        writes.push(chunk);
        return true;
      }) as any;

      try {
        await cli.run(cmd.testList, {
          root: "/project",
          argv: "--env production",
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      const output = writes.join("");
      expect(output).toContain("API_KEY");
      expect(output).toContain("DATABASE_URL");
    });

    test("shows GHA format", async ({ expect }) => {
      const { cli, cmd } = createTestEnv(
        {},
        {
          "my-app-production": {
            API_KEY: "value1",
            APP_GITHUB_CLIENT_ID: "value2",
          },
        },
      );

      const writes: string[] = [];
      const originalWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => {
        writes.push(chunk);
        return true;
      }) as any;

      try {
        await cli.run(cmd.testList, {
          root: "/project",
          argv: "--env production --format gha",
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      const output = writes.join("");
      expect(output).toContain("env:");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions `${{ ... }}` syntax in plain string
      expect(output).toContain("API_KEY: ${{ secrets.API_KEY }}");
      expect(output).toContain(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions `${{ ... }}` syntax in plain string
        "GITHUB_CLIENT_ID: ${{ secrets.APP_GITHUB_CLIENT_ID }}",
      );
    });
  });

  // -----------------------------------------------------------------------
  // environment name resolution
  // -----------------------------------------------------------------------

  describe("environment name resolution", () => {
    test("uses default pattern {project}-{env}", async ({ expect }) => {
      const { fs, store, cli, cmd } = createTestEnv();

      await fs.writeFile("/project/.env.production", "KEY=val");

      await cli.run(cmd.testApply, {
        root: "/project",
        argv: "--env production",
      });

      expect(store.wasSet("my-app-production", "KEY")).toBe(true);
    });

    test("uses custom pattern", async ({ expect }) => {
      const { fs, store, cli, cmd } = createTestEnv({
        secrets: {
          store: "github",
          environmentPattern: "deploy-{project}-{env}",
        },
      });

      await fs.writeFile("/project/.env.production", "KEY=val");

      await cli.run(cmd.testApply, {
        root: "/project",
        argv: "--env production",
      });

      expect(store.wasSet("deploy-my-app-production", "KEY")).toBe(true);
    });
  });
});
