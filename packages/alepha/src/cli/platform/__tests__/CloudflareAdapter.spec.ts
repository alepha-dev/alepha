import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, test } from "vitest";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";
import { CloudflareApi } from "../services/CloudflareApi.ts";
import { NamingService } from "../services/NamingService.ts";

/**
 * In-memory CloudflareApi for testing.
 *
 * Stores resources in maps and implements the same interface
 * without making any HTTP calls.
 */
class MemoryCloudflareApi extends CloudflareApi {
  public d1Databases: Array<{ uuid: string; name: string }> = [];
  public kvNamespaces: Array<{ id: string; title: string }> = [];
  public r2Buckets: Array<{ name: string; creation_date: string }> = [];
  public queues: Array<{ queue_id: string; queue_name: string }> = [];
  public hyperdriveConfigs: Array<{
    id: string;
    name: string;
    origin: { host: string };
  }> = [];
  public secrets: Map<string, Array<{ name: string; type: string }>> =
    new Map();

  public override async resolveToken(): Promise<string> {
    return "test-token";
  }

  public override async resolveAccountId(): Promise<string> {
    return "test-account-id";
  }

  public override async listD1() {
    return this.d1Databases;
  }

  public override async createD1(name: string) {
    const db = { uuid: `d1-${name}-uuid`, name };
    this.d1Databases.push(db);
    return db;
  }

  public override async deleteD1(databaseId: string) {
    this.d1Databases = this.d1Databases.filter((db) => db.uuid !== databaseId);
  }

  public override async listKV() {
    return this.kvNamespaces;
  }

  public override async createKV(title: string) {
    const ns = { id: `kv-${title}-id`, title };
    this.kvNamespaces.push(ns);
    return ns;
  }

  public override async deleteKV(namespaceId: string) {
    this.kvNamespaces = this.kvNamespaces.filter((ns) => ns.id !== namespaceId);
  }

  public override async listR2() {
    return this.r2Buckets;
  }

  public override async createR2(name: string) {
    this.r2Buckets.push({ name, creation_date: new Date().toISOString() });
  }

  public override async deleteR2(name: string) {
    this.r2Buckets = this.r2Buckets.filter((b) => b.name !== name);
  }

  public override async listQueues() {
    return this.queues;
  }

  public override async createQueue(name: string) {
    const queue = { queue_id: `q-${name}-id`, queue_name: name };
    this.queues.push(queue);
    return queue;
  }

  public override async deleteQueue(queueId: string) {
    this.queues = this.queues.filter((q) => q.queue_id !== queueId);
  }

  public override async listQueueConsumers() {
    return [];
  }

  public override async deleteQueueConsumer() {}

  public override async listHyperdrive() {
    return this.hyperdriveConfigs;
  }

  public override async createHyperdrive(name: string) {
    const config = { id: `hd-${name}-id`, name, origin: { host: "localhost" } };
    this.hyperdriveConfigs.push(config);
    return config;
  }

  public override async deleteHyperdrive(configId: string) {
    this.hyperdriveConfigs = this.hyperdriveConfigs.filter(
      (c) => c.id !== configId,
    );
  }

  public override async listSecrets(scriptName: string) {
    return this.secrets.get(scriptName) ?? [];
  }

  public override async putSecret(
    scriptName: string,
    name: string,
    _value: string,
  ) {
    const existing = this.secrets.get(scriptName) ?? [];
    if (!existing.some((s) => s.name === name)) {
      existing.push({ name, type: "secret_text" });
    }
    this.secrets.set(scriptName, existing);
  }

  public override async listDeployments() {
    return [];
  }

  public override async listVersions() {
    return [];
  }

  public override async deleteWorker() {}
}

describe("CloudflareAdapter", () => {
  const createTestEnv = () => {
    // Ensure D1 path (not Hyperdrive) — isPostgres() checks process.env.DATABASE_URL
    delete process.env.DATABASE_URL;

    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: CloudflareApi, use: MemoryCloudflareApi });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const dateTime = alepha.inject(DateTimeProvider);
    const adapter = alepha.inject(CloudflareAdapter);
    const naming = alepha.inject(NamingService);
    const api = alepha.inject(MemoryCloudflareApi);

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

    return { alepha, fs, shell, dateTime, adapter, naming, api };
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
    test("always validates token but skips account resolution when cache is fresh", async ({
      expect,
    }) => {
      const { adapter, shell, dateTime, naming, api } = createTestEnv();
      const ctx = makeCtx(naming);

      dateTime.pause();
      shell.outputs.set(
        "wrangler auth token --json",
        JSON.stringify({ type: "oauth", token: "test-token" }),
      );

      let resolveAccountCalls = 0;
      const originalResolve = api.resolveAccountId.bind(api);
      api.resolveAccountId = async () => {
        resolveAccountCalls++;
        return originalResolve();
      };

      const run = createMockRun();
      await adapter.authenticate(ctx, run);
      expect(resolveAccountCalls).toBe(1);

      // Second call — token still validated, but account resolution skipped
      shell.calls.length = 0;
      resolveAccountCalls = 0;
      await adapter.authenticate(ctx, run);

      expect(shell.wasCalled("wrangler auth token --json")).toBe(true);
      expect(resolveAccountCalls).toBe(0);
    });

    test("checks auth token when cache is stale", async ({ expect }) => {
      const { adapter, shell, dateTime, naming } = createTestEnv();
      const ctx = makeCtx(naming);

      shell.outputs.set(
        "wrangler auth token --json",
        JSON.stringify({ type: "oauth", token: "test-token" }),
      );
      dateTime.pause();

      const run = createMockRun();
      await adapter.authenticate(ctx, run);

      await dateTime.travel(5 * 60 * 60 * 1000); // 5 hours
      shell.calls.length = 0;

      await adapter.authenticate(ctx, run);

      expect(shell.wasCalled("wrangler auth token --json")).toBe(true);
    });
  });

  describe("provision", () => {
    test("creates D1 database via REST API when app has database", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
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

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(api.d1Databases).toHaveLength(1);
      expect(api.d1Databases[0].name).toBe("acme-portal-production");
    });

    test("skips D1 creation when database already exists", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
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

      // Pre-seed existing database
      api.d1Databases.push({
        name: "acme-portal-production",
        uuid: "existing-uuid",
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      // Should still be 1 (not 2)
      expect(api.d1Databases).toHaveLength(1);
      expect(api.d1Databases[0].uuid).toBe("existing-uuid");
    });

    test("creates R2 bucket via REST API when app has bucket", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
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

      expect(api.r2Buckets).toHaveLength(1);
      expect(api.r2Buckets[0].name).toBe("acme-portal-production");
    });

    test("creates KV namespace via REST API when app has KV", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: false,
              hasBucket: false,
              hasKV: true,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(api.kvNamespaces).toHaveLength(1);
      expect(api.kvNamespaces[0].title).toBe("acme-portal-production");
    });

    test("creates queue via REST API when app has queue", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
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
              hasQueue: true,
              hasCron: false,
            },
          },
        ],
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(api.queues).toHaveLength(1);
      expect(api.queues[0].queue_name).toBe("acme-portal-production");
    });
  });

  describe("secrets", () => {
    test("pushes non-binding env vars via REST putSecret", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
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

      const pushed = api.secrets.get("acme-portal-production") ?? [];
      const names = pushed.map((s) => s.name).sort();
      expect(names).toEqual(["APP_SECRET", "GOOGLE_API_KEY"]);
    });

    test("skips when no env file exists", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
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

      expect(api.secrets.size).toBe(0);
    });

    test("skips comments and empty lines", async ({ expect }) => {
      const { adapter, fs, naming, api } = createTestEnv();
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

      const pushed = api.secrets.get("acme-portal-production") ?? [];
      expect(pushed.map((s) => s.name)).toEqual(["ONLY_SECRET"]);
    });
  });

  describe("inspect", () => {
    test("returns state of all expected resources via REST API", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
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

      // Pre-seed existing resources
      api.d1Databases.push({
        name: "acme-portal-production",
        uuid: "db-uuid",
      });
      api.r2Buckets.push({
        name: "acme-portal-production",
        creation_date: "2025-01-01",
      });

      const run = createMockRun();
      const state = await adapter.inspect(ctx, run);

      expect(state.databases).toEqual([
        {
          name: "acme-portal-production",
          exists: true,
          id: "db-uuid",
        },
      ]);
      expect(state.buckets).toEqual([
        {
          name: "acme-portal-production",
          exists: true,
          id: "2025-01-01",
        },
      ]);
    });
  });

  describe("teardown", () => {
    test("deletes resources via REST API", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        apps: [
          {
            name: "api",
            path: "apps/api",
            entry: { root: "/project/apps/api", server: "src/main.ts" },
            resources: {
              hasDatabase: true,
              hasBucket: true,
              hasKV: true,
              hasQueue: false,
              hasCron: false,
            },
          },
        ],
      });

      // Pre-seed existing resources
      api.d1Databases.push({
        name: "acme-portal-production",
        uuid: "db-uuid",
      });
      api.r2Buckets.push({
        name: "acme-portal-production",
        creation_date: "2025-01-01",
      });
      api.kvNamespaces.push({
        id: "kv-id",
        title: "acme-portal-production",
      });

      const run = createMockRun();
      await adapter.teardown(ctx, run);

      expect(api.d1Databases).toHaveLength(0);
      // expect(api.r2Buckets).toHaveLength(0); DISABLED FOR NOW
      expect(api.kvNamespaces).toHaveLength(0);
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
