import { Alepha, AlephaError } from "alepha";
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
import { platformOptions } from "../atoms/platformOptions.ts";
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

  // Full binding set (all types), used by the bulk-PATCH path. Existing
  // tests read `api.secrets` which we keep as a secret_text-only projection
  // of this map.
  public bindings: Map<
    string,
    Array<{ type: string; name: string; text?: string }>
  > = new Map();

  public override async getWorkerSettings(scriptName: string) {
    return { bindings: this.bindings.get(scriptName) ?? [] };
  }

  public override async patchWorkerBindings(
    scriptName: string,
    bindings: Array<{ type: string; name: string; text?: string }>,
  ) {
    this.bindings.set(scriptName, bindings);
    const secretView = bindings
      .filter((b) => b.type === "secret_text")
      .map((b) => ({ name: b.name, type: "secret_text" as const }));
    this.secrets.set(scriptName, secretView);
  }

  public override async listDeployments() {
    return [];
  }

  public override async listVersions() {
    return [];
  }

  public override async deleteWorker() {}
}

/**
 * Exposes the resource-id resolution `build()` performs, so the standalone
 * build path can be asserted without driving a full bundle.
 */
class AdapterProbe extends CloudflareAdapter {
  public resolveIds(ctx: PlatformContext) {
    return this.resolveExistingResourceIds(ctx);
  }
  public d1Id() {
    return this.provisionedD1Id;
  }
  public kvId(name: string) {
    return this.provisionedKVIds.get(name);
  }
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

  /**
   * Same wiring, but with the probe subclass in place of the adapter.
   */
  const createProbeEnv = () => {
    delete process.env.DATABASE_URL;

    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: CloudflareApi, use: MemoryCloudflareApi });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const adapter = alepha.inject(AdapterProbe);
    const naming = alepha.inject(NamingService);
    const api = alepha.inject(MemoryCloudflareApi);

    fs.files.set(
      "/project/package.json",
      Buffer.from(
        JSON.stringify({
          name: "test",
          devDependencies: { wrangler: "^3.0.0" },
        }),
      ),
    );

    return { alepha, fs, adapter, naming, api };
  };

  const makeCtx = (
    naming: NamingService,
    overrides: Partial<PlatformContext> = {},
  ): PlatformContext => ({
    project: "acme-portal",
    env: "production",
    envConfig: { adapter: "cloudflare" },
    entry: { root: "/project", server: "src/main.ts" },
    resources: {
      hasDatabase: false,
      hasBucket: false,
      hasAnalytics: false,
      hasKV: false,
      hasQueue: false,
      hasCron: false,
    },
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
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: true,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
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
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: true,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
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
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: true,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
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
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: true,
          hasQueue: false,
          hasCron: false,
        },
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
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: true,
          hasCron: false,
        },
      });

      const run = createMockRun();
      await adapter.provision(ctx, run);

      expect(api.queues).toHaveLength(1);
      expect(api.queues[0].queue_name).toBe("acme-portal-production");
    });
  });

  /**
   * `build()` derived DATABASE_URL / CLOUDFLARE_KV_ID from fields that only
   * `provision()` sets, in the same process. The granular `platform build` and
   * `platform deploy` commands never call provision, so those fields were
   * empty and the emitted wrangler config silently lacked the D1 binding (or
   * carried `kv_namespaces: [{ id: "" }]`) — a worker deployed with no
   * database, failing only at the first query.
   */
  describe("build without a preceding provision", () => {
    const withDatabase = (naming: NamingService) =>
      makeCtx(naming, {
        resources: {
          hasDatabase: true,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

    const withKV = (naming: NamingService) =>
      makeCtx(naming, {
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: true,
          hasQueue: false,
          hasCron: false,
        },
      });

    test("resolves an existing D1 id from the account", async ({ expect }) => {
      const { adapter, naming, api } = createProbeEnv();
      const ctx = withDatabase(naming);

      api.d1Databases.push({
        uuid: "existing-d1-uuid",
        name: "acme-portal-production",
      });

      await adapter.resolveIds(ctx);

      expect(adapter.d1Id()).toBe("existing-d1-uuid");
    });

    test("resolves an existing KV id from the account", async ({ expect }) => {
      const { adapter, naming, api } = createProbeEnv();
      const ctx = withKV(naming);
      const kvName = naming.forContext("acme-portal", "production").kv();

      api.kvNamespaces.push({ id: "existing-kv-id", title: kvName });

      await adapter.resolveIds(ctx);

      expect(adapter.kvId(kvName)).toBe("existing-kv-id");
    });

    test("fails loudly when the D1 database does not exist yet", async ({
      expect,
    }) => {
      const { adapter, naming } = createProbeEnv();

      // Better a build that stops than a worker deployed with no binding.
      await expect(adapter.resolveIds(withDatabase(naming))).rejects.toThrow(
        /does not exist/,
      );
    });

    test("fails loudly when the KV namespace does not exist yet", async ({
      expect,
    }) => {
      const { adapter, naming } = createProbeEnv();

      await expect(adapter.resolveIds(withKV(naming))).rejects.toThrow(
        /does not exist/,
      );
    });

    test("leaves ids set by a preceding provision alone", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createProbeEnv();
      const ctx = withDatabase(naming);

      await adapter.provision(ctx, createMockRun());
      const provisioned = api.d1Databases[0].uuid;

      // A second, unrelated database on the account must not be picked up.
      api.d1Databases.unshift({ uuid: "other", name: "someone-else" });
      await adapter.resolveIds(ctx);

      expect(adapter.d1Id()).toBe(provisioned);
    });

    test("does not look anything up when the app needs no resources", async ({
      expect,
    }) => {
      const { adapter, naming } = createProbeEnv();

      await adapter.resolveIds(makeCtx(naming));

      expect(adapter.d1Id()).toBeUndefined();
    });

    test("build() itself performs the resolution", async ({ expect }) => {
      // Pins the wiring, not just the helper: a `build` that skipped the
      // lookup is exactly the bug, and it fails silently.
      const { adapter, naming } = createTestEnv();

      await expect(
        adapter.build(withDatabase(naming), createMockRun()),
      ).rejects.toThrow(/does not exist/);
    });
  });

  /**
   * Unlike D1/R2/KV/Queue, there is no `ensureAnalytics()` step and no id to
   * resolve — Cloudflare has no API to create an Analytics Engine dataset
   * ahead of time, it materializes on the first `writeDataPoint()`. So
   * "provisioning" it is entirely this env-wiring in `build()`.
   */
  describe("build — analytics env wiring", () => {
    const buildCommand = "alepha build -t cloudflare";

    const withAnalytics = (naming: NamingService) =>
      makeCtx(naming, {
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: true,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

    test("computes CLOUDFLARE_ANALYTICS_DATASET from naming when hasAnalytics and nothing is set explicitly", async ({
      expect,
    }) => {
      const { adapter, shell, naming } = createTestEnv();

      await adapter.build(withAnalytics(naming), createMockRun());

      const call = shell.calls.find((c) => c.command === buildCommand);
      expect(call?.options.env?.CLOUDFLARE_ANALYTICS_DATASET).toBe(
        "acme-portal-production",
      );
    });

    test("leaves CLOUDFLARE_ANALYTICS_DATASET unset when the app has no analytics dataset", async ({
      expect,
    }) => {
      const { adapter, shell, naming } = createTestEnv();

      await adapter.build(makeCtx(naming), createMockRun());

      const call = shell.calls.find((c) => c.command === buildCommand);
      expect(call?.options.env?.CLOUDFLARE_ANALYTICS_DATASET).toBeUndefined();
    });

    test("an explicit .env.<env> value wins over the naming-computed one", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();

      await fs.writeFile(
        "/project/.env.production",
        "CLOUDFLARE_ANALYTICS_DATASET=sigil_analytics\n",
      );

      await adapter.build(withAnalytics(naming), createMockRun());

      const call = shell.calls.find((c) => c.command === buildCommand);
      expect(call?.options.env?.CLOUDFLARE_ANALYTICS_DATASET).toBe(
        "sigil_analytics",
      );
    });

    test("forwards an explicit .env.<env> value even with no $analytics primitive detected (escape hatch)", async ({
      expect,
    }) => {
      const { adapter, fs, shell, naming } = createTestEnv();

      await fs.writeFile(
        "/project/.env.production",
        "CLOUDFLARE_ANALYTICS_DATASET=sigil_analytics\n",
      );

      // hasAnalytics: false — mirrors an app that only ever set the env var
      // by hand, the historical workaround this feature replaces.
      await adapter.build(makeCtx(naming), createMockRun());

      const call = shell.calls.find((c) => c.command === buildCommand);
      expect(call?.options.env?.CLOUDFLARE_ANALYTICS_DATASET).toBe(
        "sigil_analytics",
      );
    });
  });

  describe("secrets", () => {
    test("pushes non-binding env vars via REST putSecret", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
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

    test("with platform.secrets.keys, resolves the allowlist from process.env (no .env file) and ignores ambient vars", async ({
      expect,
    }) => {
      const { adapter, alepha, naming, api } = createTestEnv();
      // Declare an explicit allowlist — the CI shape: secrets arrive via the
      // job environment, there is no .env.production on the runner.
      alepha.set(platformOptions, {
        secrets: { keys: ["APP_SECRET", "GOOGLE_CLIENT_ID", "EMAIL_FROM"] },
        environments: { production: { adapter: "cloudflare" } },
      } as any);

      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      process.env.APP_SECRET = "from-env-secret";
      process.env.GOOGLE_CLIENT_ID = "from-env-google";
      // EMAIL_FROM intentionally unset → declared but unresolved, not pushed.
      // PATH-style ambient var that must never leak into worker secrets.
      process.env.AMBIENT_RUNNER_VAR = "leak-me-not";
      try {
        const run = createMockRun();
        await adapter.secrets(ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.AMBIENT_RUNNER_VAR;
      }

      const pushed = api.secrets.get("acme-portal-production") ?? [];
      const names = pushed.map((s) => s.name).sort();
      expect(names).toEqual(["APP_SECRET", "GOOGLE_CLIENT_ID"]);
    });

    test("with platform.secrets.keys, the .env file overrides process.env per key", async ({
      expect,
    }) => {
      const { adapter, alepha, fs, naming, api } = createTestEnv();
      alepha.set(platformOptions, {
        secrets: { keys: ["APP_SECRET", "GOOGLE_CLIENT_ID"] },
        environments: { production: { adapter: "cloudflare" } },
      } as any);

      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // APP_SECRET in the file → file wins. GOOGLE_CLIENT_ID only in env → env.
      await fs.writeFile(
        "/project/.env.production",
        ["APP_SECRET=from-file", ""].join("\n"),
      );
      process.env.APP_SECRET = "from-env";
      process.env.GOOGLE_CLIENT_ID = "env-google";
      try {
        const run = createMockRun();
        await adapter.secrets(ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
      }

      // Secret *values* land in the full binding set (api.bindings); the
      // api.secrets projection only keeps names.
      const bindings = api.bindings.get("acme-portal-production") ?? [];
      const byName = Object.fromEntries(
        bindings
          .filter((b) => b.type === "secret_text")
          .map((b) => [b.name, b.text]),
      );
      expect(byName.APP_SECRET).toBe("from-file");
      expect(byName.GOOGLE_CLIENT_ID).toBe("env-google");
    });

    test("uses dist/manifest.json `env` as the default allowlist, resolved from process.env", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      // No platform.secrets.keys and no .env file → the manifest's declared
      // env list is the allowlist. This is the CI shape.
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({
          env: [
            "APP_SECRET",
            "GOOGLE_CLIENT_ID",
            "CLOUDFLARE_ZONE",
            "LOG_LEVEL",
          ],
        }),
      );

      process.env.APP_SECRET = "s1";
      process.env.GOOGLE_CLIENT_ID = "g1";
      process.env.CLOUDFLARE_ZONE = "example.com"; // declared but EXCLUDED
      // LOG_LEVEL is declared + ambient in the runner, but EXCLUDED (infra knob).
      try {
        const run = createMockRun();
        await adapter.secrets(ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.CLOUDFLARE_ZONE;
      }

      const pushed = api.secrets.get("acme-portal-production") ?? [];
      expect(pushed.map((s) => s.name).sort()).toEqual([
        "APP_SECRET",
        "GOOGLE_CLIENT_ID",
      ]);
    });

    test("pushes per-deploy keys from .env.<env>.local even when not in the manifest", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // Manifest declares only APP_SECRET…
      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({ env: ["APP_SECRET"] }),
      );
      // …but an orchestrator (Rocket) injected CLUB_CONFIG_JSON into the
      // per-deploy override file. It must still be pushed.
      await fs.writeFile(
        "/project/.env.production.local",
        ["APP_SECRET=s1", 'CLUB_CONFIG_JSON={"id":"b14"}', ""].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      const pushed = api.secrets.get("acme-portal-production") ?? [];
      expect(pushed.map((s) => s.name).sort()).toEqual([
        "APP_SECRET",
        "CLUB_CONFIG_JSON",
      ]);
    });

    test("platform.secrets.keys overrides the manifest `env` allowlist", async ({
      expect,
    }) => {
      const { adapter, alepha, fs, naming, api } = createTestEnv();
      alepha.set(platformOptions, {
        secrets: { keys: ["APP_SECRET"] }, // narrow override
        environments: { production: { adapter: "cloudflare" } },
      } as any);

      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // Manifest lists more keys, but the explicit override wins.
      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({ env: ["APP_SECRET", "GOOGLE_CLIENT_ID"] }),
      );

      process.env.APP_SECRET = "s1";
      process.env.GOOGLE_CLIENT_ID = "g1";
      try {
        const run = createMockRun();
        await adapter.secrets(ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
      }

      const pushed = api.secrets.get("acme-portal-production") ?? [];
      expect(pushed.map((s) => s.name)).toEqual(["APP_SECRET"]);
    });

    test("auto-derives PUBLIC_URL from the configured domain", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        envConfig: { adapter: "cloudflare", domain: "lore.alepha.dev" },
      });

      await fs.writeFile(
        "/project/.env.production",
        ["APP_SECRET=my-secret", ""].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      const bindings = api.bindings.get("acme-portal-production") ?? [];
      const publicUrl = bindings.find((b) => b.name === "PUBLIC_URL");
      expect(publicUrl?.text).toBe("https://lore.alepha.dev");
    });

    test("honors an explicit PUBLIC_URL over the derived one", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        envConfig: { adapter: "cloudflare", domain: "lore.alepha.dev" },
      });

      await fs.writeFile(
        "/project/.env.production",
        ["PUBLIC_URL=https://custom.example.com", ""].join("\n"),
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      const bindings = api.bindings.get("acme-portal-production") ?? [];
      const publicUrl = bindings.find((b) => b.name === "PUBLIC_URL");
      expect(publicUrl?.text).toBe("https://custom.example.com");
    });

    test("skips when no env file exists", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      const run = createMockRun();
      await adapter.secrets(ctx, run);

      expect(api.secrets.size).toBe(0);
    });

    test("skips comments and empty lines", async ({ expect }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
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

    test("skips PATCH when ALEPHA_SECRETS_HASH binding matches", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      await fs.writeFile(
        "/project/.env.production",
        ["APP_SECRET=my-secret", "GOOGLE_API_KEY=sk-123"].join("\n"),
      );

      const run = createMockRun();

      // First push lands the hash binding on the worker.
      await adapter.secrets(ctx, run);

      const firstBindings = api.bindings.get("acme-portal-production") ?? [];
      const hashBinding = firstBindings.find(
        (b) => b.name === "ALEPHA_SECRETS_HASH",
      );
      expect(hashBinding?.type).toBe("plain_text");
      // Salted + slow-KDF fingerprint (`v2:<salt>:<digest>`) — a bare sha256
      // of the values in a readable binding is an offline brute-force oracle.
      expect(hashBinding?.text).toMatch(/^v2:[a-f0-9]{32}:[a-f0-9]{64}$/);
      expect(hashBinding?.text).not.toContain("my-secret");

      // Mutate the bindings to a sentinel set we can watch for accidental
      // overwrites. If the second `secrets()` call decides to PATCH again,
      // the sentinel would be wiped.
      api.bindings.set("acme-portal-production", [
        ...firstBindings,
        { type: "plain_text", name: "__SENTINEL__", text: "untouched" },
      ]);

      await adapter.secrets(ctx, run);

      const afterBindings = api.bindings.get("acme-portal-production") ?? [];
      expect(afterBindings.find((b) => b.name === "__SENTINEL__")?.text).toBe(
        "untouched",
      );
    });

    test("PATCHes when secrets changed (hash mismatch)", async ({ expect }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      await fs.writeFile("/project/.env.production", "APP_SECRET=v1");

      const run = createMockRun();
      await adapter.secrets(ctx, run);
      const firstHash = api.bindings
        .get("acme-portal-production")
        ?.find((b) => b.name === "ALEPHA_SECRETS_HASH")?.text;

      // Same key, different value → hash should change → fresh PATCH.
      await fs.writeFile("/project/.env.production", "APP_SECRET=v2");
      await adapter.secrets(ctx, run);

      const secondHash = api.bindings
        .get("acme-portal-production")
        ?.find((b) => b.name === "ALEPHA_SECRETS_HASH")?.text;

      expect(firstHash).toBeTruthy();
      expect(secondHash).toBeTruthy();
      expect(secondHash).not.toBe(firstHash);
    });

    test("pushes manifest `publicVars` as plain_text, everything else encrypted", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({
          env: ["APP_SECRET", "SIGIL_CONFIG", "SIGIL_KEY"],
          publicVars: ["SIGIL_CONFIG"],
        }),
      );
      await fs.writeFile(
        "/project/.env.production",
        [
          "APP_SECRET=my-secret",
          'SIGIL_CONFIG={"project":"demo"}',
          "SIGIL_KEY=sg_123",
        ].join("\n"),
      );

      await adapter.secrets(ctx, createMockRun());

      const bindings = api.bindings.get("acme-portal-production") ?? [];
      const byName = Object.fromEntries(bindings.map((b) => [b.name, b]));

      // Declassified → readable and editable in the dashboard.
      expect(byName.SIGIL_CONFIG?.type).toBe("plain_text");
      expect(byName.SIGIL_CONFIG?.text).toBe('{"project":"demo"}');

      // Everything not on the list stays encrypted — including the key that
      // sits right next to it in the same module.
      expect(byName.SIGIL_KEY?.type).toBe("secret_text");
      expect(byName.APP_SECRET?.type).toBe("secret_text");
    });

    test("does not declassify a key the app never vouched for", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      // No `publicVars` at all: the shape of every artifact built before the
      // field existed. It must encrypt everything rather than read the absent
      // list as "nothing is secret".
      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({ env: ["APP_SECRET", "SIGIL_CONFIG"] }),
      );
      await fs.writeFile(
        "/project/.env.production",
        ["APP_SECRET=my-secret", 'SIGIL_CONFIG={"project":"demo"}'].join("\n"),
      );

      await adapter.secrets(ctx, createMockRun());

      const bindings = api.bindings.get("acme-portal-production") ?? [];
      expect(
        bindings
          .filter((b) => b.name !== "ALEPHA_SECRETS_HASH")
          .every((b) => b.type === "secret_text"),
      ).toBe(true);
    });

    test("re-PATCHes when a key is declassified without its value changing", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({ env: ["SIGIL_CONFIG"] }),
      );
      await fs.writeFile(
        "/project/.env.production",
        'SIGIL_CONFIG={"project":"demo"}',
      );

      const run = createMockRun();
      await adapter.secrets(ctx, run);
      expect(
        api.bindings
          .get("acme-portal-production")
          ?.find((b) => b.name === "SIGIL_CONFIG")?.type,
      ).toBe("secret_text");

      // Only the annotation changes — the value is byte-identical. A
      // fingerprint over values alone would match here and skip the PATCH,
      // leaving the binding encrypted until some unrelated secret changed.
      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({ env: ["SIGIL_CONFIG"], publicVars: ["SIGIL_CONFIG"] }),
      );
      await adapter.secrets(ctx, run);

      const after = api.bindings.get("acme-portal-production") ?? [];
      expect(after.find((b) => b.name === "SIGIL_CONFIG")?.type).toBe(
        "plain_text",
      );
      // And it is written once, not inherited as a secret AND upserted as a var.
      expect(after.filter((b) => b.name === "SIGIL_CONFIG")).toHaveLength(1);
    });

    test("pushes the auto-derived PUBLIC_URL as plain_text", async ({
      expect,
    }) => {
      const { adapter, fs, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        envConfig: { adapter: "cloudflare", domain: "lore.alepha.dev" },
      });

      // No manifest at all: PUBLIC_URL is invented by the adapter from the
      // configured domain, so it can never appear on `publicVars`. It is
      // plaintext regardless — it is the address the app answers on.
      await fs.writeFile("/project/.env.production", "APP_SECRET=my-secret");

      await adapter.secrets(ctx, createMockRun());

      const bindings = api.bindings.get("acme-portal-production") ?? [];
      const publicUrl = bindings.find((b) => b.name === "PUBLIC_URL");
      expect(publicUrl?.type).toBe("plain_text");
      expect(publicUrl?.text).toBe("https://lore.alepha.dev");
      expect(bindings.find((b) => b.name === "APP_SECRET")?.type).toBe(
        "secret_text",
      );
    });
  });

  describe("inspect", () => {
    test("returns state of all expected resources via REST API", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: true,
          hasBucket: true,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
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
        entry: { root: "/project", server: "src/main.ts" },
        resources: {
          hasDatabase: true,
          hasBucket: true,
          hasAnalytics: false,
          hasKV: true,
          hasQueue: false,
          hasCron: false,
        },
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

  describe("exportDb", () => {
    const withDatabase = (naming: NamingService) =>
      makeCtx(naming, {
        resources: {
          hasDatabase: true,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

    /**
     * A `run()` that plays the two shell steps for real enough to test the
     * code between them: `wrangler d1 export` writes `dump` to the `--output`
     * path, and `sqlite3 '<db>' < '<sql>'` copies whatever is in the dump at
     * that moment into the target file. `failImport` makes the import throw
     * AFTER writing a partial file, which is exactly what sqlite3 does: it
     * commits every statement it parsed before the error.
     */
    const shellRun = (
      fs: MemoryFileSystemProvider,
      opts: { dump: Buffer | string; failImport?: boolean } = {
        dump: "-- empty\n",
      },
    ) => {
      const commands: string[] = [];
      const run: any = async (cmd: any) => {
        if (typeof cmd !== "string") return;
        commands.push(cmd);
        const exported = /--output="([^"]+)"/.exec(cmd);
        if (exported) {
          await fs.writeFile(exported[1], opts.dump);
          return;
        }
        const imported = /sqlite3 '([^']+)' < '([^']+)'/.exec(cmd);
        if (imported) {
          const sql = await fs.readFile(imported[2]);
          if (opts.failImport) {
            await fs.writeFile(imported[1], "PARTIAL");
            throw new AlephaError("Parse error near line 2134");
          }
          await fs.writeFile(imported[1], sql);
        }
      };
      run.end = () => {};
      return { run, commands };
    };

    test("dumps remote D1 and imports it into a local SQLite snapshot", async ({
      expect,
    }) => {
      const { adapter, naming, fs } = createTestEnv();
      const ctx = withDatabase(naming);
      const { run, commands } = shellRun(fs, { dump: "-- rows\n" });

      await adapter.exportDb(ctx, run, {
        output: "/tmp/snap.db",
        keepSql: true,
      });

      expect(
        commands.some((c) => /^wrangler d1 export .+ --remote /.test(c)),
      ).toBe(true);
      // Staged, not written straight into the snapshot — see below.
      expect(
        commands.some((c) => /sqlite3 '\/tmp\/snap\.db\.import' < /.test(c)),
      ).toBe(true);
      expect(fs.files.get("/tmp/snap.db")?.toString()).toBe("-- rows\n");
      // The scratch file never survives a run.
      expect(fs.files.has("/tmp/snap.db.import")).toBe(false);
    });

    test("escapes a raw NUL byte in the dump before the import", async ({
      expect,
    }) => {
      const { adapter, naming, fs } = createTestEnv();
      const ctx = withDatabase(naming);
      // The shape that broke the lore export: a raw 0x00 inside a text
      // literal, with a following row for the parser to misblame.
      const dump = Buffer.concat([
        Buffer.from("INSERT INTO t VALUES('a"),
        Buffer.from([0x00]),
        Buffer.from("b');\nINSERT INTO t VALUES('next');\n"),
      ]);
      const { run } = shellRun(fs, { dump });

      await adapter.exportDb(ctx, run, {
        output: "/tmp/snap.db",
        keepSql: true,
      });

      const imported = fs.files.get("/tmp/snap.db")!;
      // sqlite3 reads its input as C strings, so one of these ends the
      // INSERT early and the syntax error lands on the FOLLOWING row.
      expect(imported.includes(0x00)).toBe(false);
      // Escaped, not stripped: a backslash is not special inside a SQLite
      // string literal, so the two characters survive into the data.
      expect(imported.toString()).toContain("VALUES('a\\0b')");
      expect(imported.toString()).toContain("VALUES('next')");
    });

    test("leaves a clean dump alone", async ({ expect }) => {
      const { adapter, naming, fs } = createTestEnv();
      const ctx = withDatabase(naming);
      const { run } = shellRun(fs, { dump: "INSERT INTO t VALUES('ok');\n" });

      await adapter.exportDb(ctx, run, {
        output: "/tmp/snap.db",
        keepSql: true,
      });

      // These dumps run to tens of megabytes, so a clean one must not be
      // read back out and rewritten. `wrangler d1 export` wrote it once.
      expect(
        fs.writeFileCalls.filter((c) => c.path.endsWith(".sql")),
      ).toHaveLength(1);
    });

    test("keeps the existing snapshot when the import fails", async ({
      expect,
    }) => {
      const { adapter, naming, fs } = createTestEnv();
      const ctx = withDatabase(naming);
      await fs.writeFile("/tmp/snap.db", "WORKING DEV DB");
      const { run } = shellRun(fs, { dump: "-- rows\n", failImport: true });

      await expect(
        adapter.exportDb(ctx, run, { output: "/tmp/snap.db", keepSql: true }),
      ).rejects.toThrow(/Parse error/);

      // The whole point: a failed import used to leave a silently partial
      // database where a working one had been, because `dbPath` was removed
      // up front and sqlite3 commits what it parsed before the error.
      expect(fs.files.get("/tmp/snap.db")?.toString()).toBe("WORKING DEV DB");
      expect(fs.files.has("/tmp/snap.db.import")).toBe(false);
    });

    test("refuses when no database is detected", async ({ expect }) => {
      const { adapter, naming } = createTestEnv();
      const ctx = makeCtx(naming); // resources.hasDatabase defaults to false
      const run = createMockRun();
      await expect(adapter.exportDb(ctx, run)).rejects.toThrow(/no database/i);
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
  run.end = () => {};
  return run;
}
