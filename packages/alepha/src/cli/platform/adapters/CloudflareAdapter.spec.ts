import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import { NamingService } from "../services/NamingService.ts";
import { CloudflareAdapter } from "./CloudflareAdapter.ts";
import type { PlatformContext } from "./PlatformAdapter.ts";

describe("CloudflareAdapter", () => {
  const createTestEnv = () => {
    // Ensure D1 path (not Hyperdrive) — isPostgres() checks process.env.DATABASE_URL
    delete process.env.DATABASE_URL;

    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const dateTime = alepha.inject(DateTimeProvider);
    const adapter = alepha.inject(CloudflareAdapter);
    const naming = alepha.inject(NamingService);

    // Pre-seed package.json so ensureDependency finds wrangler already installed
    fs.files.set(
      "/project/package.json",
      Buffer.from(
        JSON.stringify({
          name: "test",
          devDependencies: { wrangler: "^3.0.0" },
        }),
      ),
    );

    return { alepha, fs, shell, dateTime, adapter, naming };
  };

  const makeCtx = (
    naming: NamingService,
    overrides: Partial<PlatformContext> = {},
  ): PlatformContext => ({
    project: "acme-portal",
    env: "production",
    envConfig: { adapter: "cloudflare" },
    apps: [],
    root: "/project",
    naming: naming.forContext("acme-portal", "production"),
    ...overrides,
  });

  describe("authenticate", () => {
    test("skips wrangler whoami when cache is fresh", async ({ expect }) => {
      const { adapter, shell, dateTime, naming } = createTestEnv();
      const ctx = makeCtx(naming);

      // Pre-warm cache
      dateTime.pause();
      shell.outputs.set("wrangler whoami", "Account Name | abc123");

      const run = createMockRun();
      await adapter.authenticate(ctx, run);

      // Reset shell calls, call again -- should use cache
      shell.calls.length = 0;
      await adapter.authenticate(ctx, run);

      expect(shell.wasCalled("wrangler whoami")).toBe(false);
    });

    test("calls wrangler whoami when cache is stale", async ({ expect }) => {
      const { adapter, shell, dateTime, naming } = createTestEnv();
      const ctx = makeCtx(naming);

      shell.outputs.set("wrangler whoami", "Account Name | abc123");
      dateTime.pause();

      const run = createMockRun();
      await adapter.authenticate(ctx, run);

      await dateTime.travel(5 * 60 * 60 * 1000); // 5 hours
      shell.calls.length = 0;

      await adapter.authenticate(ctx, run);

      expect(shell.wasCalled("wrangler whoami")).toBe(true);
    });
  });

  describe("provision", () => {
    test("creates D1 database when app has database", async ({ expect }) => {
      const { adapter, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      shell.outputs.set("wrangler d1 list --json", "[]");
      shell.outputs.set(
        "wrangler d1 create acme-portal-production",
        '{ "database_id": "uuid-123" }',
      );

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(
        shell.wasCalledMatching(/wrangler d1 create acme-portal-production/),
      ).toBe(true);
    });

    test("skips D1 creation when database already exists", async ({
      expect,
    }) => {
      const { adapter, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      shell.outputs.set(
        "wrangler d1 list --json",
        JSON.stringify([
          {
            name: "acme-portal-production",
            uuid: "existing-uuid",
          },
        ]),
      );

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(shell.wasCalledMatching(/wrangler d1 create/)).toBe(false);
    });

    test("creates R2 bucket when app has bucket", async ({ expect }) => {
      const { adapter, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: true,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(
        shell.wasCalledMatching(
          /wrangler r2 bucket create acme-portal-production/,
        ),
      ).toBe(true);
    });
  });

  describe("secrets", () => {
    test("pushes non-binding env vars via wrangler secret bulk", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      // Write .env.production with a mix of secrets and excluded vars
      await fs.writeFile(
        "/project/.env.production",
        [
          "GOOGLE_API_KEY=sk-123",
          "APP_SECRET=my-secret",
          "DATABASE_URL=d1://mydb",
          "R2_BUCKET_NAME=my-bucket",
          "CLOUDFLARE_DOMAIN=example.com",
          "VITE_PUBLIC_KEY=public-abc",
          "NODE_ENV=production",
          "",
        ].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      // Should call wrangler secret bulk with the worker name
      expect(
        shell.wasCalledMatching(
          /wrangler secret bulk.*--name=acme-portal-production/,
        ),
      ).toBe(true);

      // Verify the secrets JSON was written (only non-excluded vars)
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /GOOGLE_API_KEY/,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /APP_SECRET/,
        ),
      ).toBe(true);

      // Excluded vars should NOT be in the secrets file
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /DATABASE_URL/,
        ),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /R2_BUCKET_NAME/,
        ),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /CLOUDFLARE_DOMAIN/,
        ),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /VITE_PUBLIC_KEY/,
        ),
      ).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /NODE_ENV/,
        ),
      ).toBe(false);
    });

    test("skips when no env file exists", async ({ expect }) => {
      const { adapter, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      expect(shell.wasCalledMatching(/wrangler secret/)).toBe(false);
    });

    test("skips comments and empty lines", async ({ expect }) => {
      const { adapter, fs, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      await fs.writeFile(
        "/project/.env.production",
        ["# This is a comment", "", "ONLY_SECRET=value"].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      expect(shell.wasCalledMatching(/wrangler secret bulk/)).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /ONLY_SECRET/,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/node_modules/.alepha/secrets.json",
          /comment/,
        ),
      ).toBe(false);
    });
  });

  describe("inspect", () => {
    test("returns state of all expected resources", async ({ expect }) => {
      const { adapter, shell, naming } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: true,
              hasKV: false,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      shell.outputs.set(
        "wrangler d1 list --json",
        JSON.stringify([{ name: "acme-portal-production", uuid: "db-uuid" }]),
      );
      shell.outputs.set("wrangler r2 bucket list", "acme-portal-production");

      const run = createMockRun();
      const state = await adapter.inspect(ctx, run);

      expect(state.databases).toEqual([
        {
          name: "acme-portal-production",
          exists: true,
          id: "db-uuid",
        },
      ]);
    });
  });
});

/**
 * Create a mock RunnerMethod that just executes handlers directly.
 */
function createMockRun(): any {
  const run: any = async (task: any) => {
    if (Array.isArray(task)) {
      await Promise.all(
        task.map((t) =>
          typeof t === "object" && t.handler ? t.handler() : Promise.resolve(),
        ),
      );
    }
    if (typeof task === "object" && task.handler) {
      await task.handler();
    }
  };
  run.pause = () => {};
  run.resume = () => {};
  run.end = () => {};
  return run;
}
