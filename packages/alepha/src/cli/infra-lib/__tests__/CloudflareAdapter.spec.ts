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
import type { InfraContext } from "../adapters/InfraAdapter.ts";
import { WorkerCloudflareAdapter } from "../adapters/WorkerCloudflareAdapter.ts";
import { infraOptions } from "../atoms/infraOptions.ts";
import { cloudflare } from "../index.ts";
import { CloudflareCredentialSource } from "../services/CloudflareCredentialSource.ts";
import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";
import { NamingService } from "../services/NamingService.ts";

/**
 * These transport/secret tests model completed builds. The artifact preflight
 * is exercised on the real adapters in localDeployArtifacts.spec.ts.
 */
class ArtifactReadyCloudflareAdapter extends CloudflareAdapter {
  /**
   * The account, in memory.
   */
  public readonly memory = new MemoryProvisionClient();

  protected override async validateDeployArtifact(): Promise<void> {}

  protected override provisioner() {
    return this.memory;
  }

  protected override deployer() {
    return {
      activeDeployment: async () => undefined,
    } as unknown as ReturnType<CloudflareAdapter["deployer"]>;
  }

  public undeclaredSecrets(
    ...args: Parameters<CloudflareAdapter["reportUndeclaredSecrets"]>
  ) {
    return this.reportUndeclaredSecrets(...args);
  }
}

/**
 * The upload, recorded rather than sent: what the CLI hands the one deploy
 * path. What that path makes of it is `WorkerCloudflareAdapter.spec.ts`.
 */
class CapturingWorkerAdapter extends WorkerCloudflareAdapter {
  public uploads: Array<{
    root: string;
    secrets: Record<string, string>;
    apiToken?: string;
  }> = [];

  override async deploy(ctx: InfraContext<any>): Promise<string | undefined> {
    this.uploads.push({
      root: ctx.root,
      secrets: { ...this.appSecrets },
      apiToken: this.credential?.apiToken,
    });
    return undefined;
  }
}

/**
 * A run whose credential is already settled; where it comes from is
 * `CloudflareCredentialSource.spec.ts`.
 */
class SettledCredentialSource extends CloudflareCredentialSource {
  public override async token() {
    return { token: "test-token", origin: "env" as const };
  }

  public override async resolve() {
    return {
      credential: { apiToken: "test-token", accountId: "test-account-id" },
      origin: "env" as const,
    };
  }
}

/**
 * An in-memory Cloudflare account, behind the provisioning client the
 * adapter uses (#Q2613). No HTTP call is made.
 */
class MemoryProvisionClient extends CloudflareProvisionClient {
  public d1Databases: Array<{ uuid: string; name: string }> = [];
  public d1Hints: Record<string, string | undefined> = {};
  public kvNamespaces: Array<{ id: string; title: string }> = [];
  public r2Buckets: Array<{ name: string; creation_date: string }> = [];
  public queues: Array<{ queue_id: string; queue_name: string }> = [];
  public unbound: Array<{ queueId: string; script: string }> = [];
  public deletedWorkers: string[] = [];
  public hyperdriveConfigs: Array<{
    id: string;
    name: string;
    origin: { host: string };
  }> = [];
  public secrets: Map<string, Array<{ name: string; type: string }>> =
    new Map();

  constructor() {
    super({ apiToken: "test-token", accountId: "test-account-id" });
  }

  public override async listD1() {
    return this.d1Databases as never;
  }

  public override async ensureD1(
    name: string,
    options: { locationHint?: string } = {},
  ) {
    const existing = this.d1Databases.find((db) => db.name === name);
    if (existing) return existing as never;
    const db = { uuid: `d1-${name}-uuid`, name };
    this.d1Databases.push(db);
    this.d1Hints[name] = options.locationHint;
    return db as never;
  }

  public override async deleteD1(databaseId: string) {
    this.d1Databases = this.d1Databases.filter((db) => db.uuid !== databaseId);
  }

  public override async listKV() {
    return this.kvNamespaces as never;
  }

  public override async ensureKV(title: string) {
    const existing = this.kvNamespaces.find((ns) => ns.title === title);
    if (existing) return existing as never;
    const ns = { id: `kv-${title}-id`, title };
    this.kvNamespaces.push(ns);
    return ns as never;
  }

  public override async deleteKV(namespaceId: string) {
    this.kvNamespaces = this.kvNamespaces.filter((ns) => ns.id !== namespaceId);
  }

  public override async listR2() {
    return this.r2Buckets as never;
  }

  public override async ensureR2(name: string) {
    if (!this.r2Buckets.some((b) => b.name === name)) {
      this.r2Buckets.push({ name, creation_date: "2026-10-11T00:00:00Z" });
    }
  }

  public override async deleteR2Bucket(name: string) {
    this.r2Buckets = this.r2Buckets.filter((b) => b.name !== name);
  }

  public override async listQueues() {
    return this.queues as never;
  }

  public override async ensureQueue(name: string) {
    const existing = this.queues.find((q) => q.queue_name === name);
    if (existing) return existing as never;
    const queue = { queue_id: `q-${name}-id`, queue_name: name };
    this.queues.push(queue);
    return queue as never;
  }

  public override async deleteQueue(name: string) {
    this.queues = this.queues.filter((q) => q.queue_name !== name);
  }

  public override async deleteQueueConsumer(queueId: string, script: string) {
    this.unbound.push({ queueId, script });
  }

  public override async listHyperdrive() {
    return this.hyperdriveConfigs as never;
  }

  public override async ensureHyperdrive(name: string) {
    const existing = this.hyperdriveConfigs.find((c) => c.name === name);
    if (existing) return existing as never;
    const config = { id: `hd-${name}-id`, name, origin: { host: "localhost" } };
    this.hyperdriveConfigs.push(config);
    return config as never;
  }

  public override async deleteHyperdrive(configId: string) {
    this.hyperdriveConfigs = this.hyperdriveConfigs.filter(
      (c) => c.id !== configId,
    );
  }

  public override async listSecrets(scriptName: string) {
    return this.secrets.get(scriptName) ?? [];
  }

  public override async deleteWorker(name: string) {
    this.deletedWorkers.push(name);
  }
}

/**
 * Exposes the resource-id resolution `build()` performs, so the standalone
 * build path can be asserted without driving a full bundle.
 */
class AdapterProbe extends ArtifactReadyCloudflareAdapter {
  public resolveIds(ctx: InfraContext<any>) {
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
    // Ensure D1 path (not Hyperdrive)  -  isPostgres() checks process.env.DATABASE_URL
    delete process.env.DATABASE_URL;

    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({
        provide: CloudflareCredentialSource,
        use: SettledCredentialSource,
      })
      .with({ provide: WorkerCloudflareAdapter, use: CapturingWorkerAdapter })
      .with({
        provide: CloudflareAdapter,
        use: ArtifactReadyCloudflareAdapter,
      });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const dateTime = alepha.inject(DateTimeProvider);
    const adapter = alepha.inject(CloudflareAdapter);
    // Transient, so it is the adapter's own instance and not the container's.
    const worker = (
      adapter as unknown as { workerAdapter: CapturingWorkerAdapter }
    ).workerAdapter;
    const naming = alepha.inject(NamingService);
    const api = (adapter as unknown as ArtifactReadyCloudflareAdapter).memory;

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

    return { alepha, fs, shell, dateTime, adapter, naming, api, worker };
  };

  /**
   * Same wiring, but with the probe subclass in place of the adapter.
   */
  const createProbeEnv = () => {
    delete process.env.DATABASE_URL;

    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({
        provide: CloudflareCredentialSource,
        use: SettledCredentialSource,
      })
      .with({
        provide: CloudflareAdapter,
        use: ArtifactReadyCloudflareAdapter,
      });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const adapter = alepha.inject(AdapterProbe);
    const naming = alepha.inject(NamingService);
    const api = adapter.memory;

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
    overrides: Partial<InfraContext<any>> = {},
  ): InfraContext<any> => ({
    project: "acme-portal",
    env: "production",
    options: {},
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

  describe("container", () => {
    test("builds in either order, Lore's (the Worker adapter first) included", async ({
      expect,
    }) => {
      // The CLI adapter injects the Worker adapter, whose dependencies
      // register this module. A singleton there made Lore's order a
      // CircularDependencyError (#Q2612).
      const workerFirst = Alepha.create();
      expect(workerFirst.inject(WorkerCloudflareAdapter)).toBeTruthy();
      expect(workerFirst.inject(CloudflareAdapter)).toBeTruthy();

      const cliFirst = Alepha.create();
      expect(cliFirst.inject(CloudflareAdapter)).toBeTruthy();
      expect(cliFirst.inject(WorkerCloudflareAdapter)).toBeTruthy();
    });
  });

  // `authenticate` is `CloudflareCredentialSource.resolve`, and its three
  // branches (environment token, wrangler token once per run, login on a TTY
  // only) are covered in `CloudflareCredentialSource.spec.ts`.

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

      // The dead-letter queue beside it: the build names it as the
      // consumer's, and the API refuses a consumer whose DLQ is missing.
      expect(api.queues.map((q) => q.queue_name).sort()).toEqual([
        "acme-portal-production",
        "acme-portal-production-dlq",
      ]);
    });

    test("creates D1 with the weur location hint the CLI has always used", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        resources: {
          hasDatabase: true,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
        },
      });

      await adapter.provision(ctx, createMockRun());

      expect(api.d1Hints).toEqual({ "acme-portal-production": "weur" });
    });

    test("a second provision creates nothing", async ({ expect }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        resources: {
          hasDatabase: true,
          hasBucket: true,
          hasAnalytics: false,
          hasKV: true,
          hasQueue: true,
          hasCron: false,
        },
      });

      await adapter.provision(ctx, createMockRun());
      const first = JSON.stringify([
        api.d1Databases,
        api.r2Buckets,
        api.kvNamespaces,
        api.queues,
      ]);
      await adapter.provision(ctx, createMockRun());

      expect(
        JSON.stringify([
          api.d1Databases,
          api.r2Buckets,
          api.kvNamespaces,
          api.queues,
        ]),
      ).toBe(first);
    });
  });

  /**
   * `build()` derived DATABASE_URL / CLOUDFLARE_KV_ID from fields that only
   * `provision()` sets, in the same process. The granular `platform build` and
   * `platform deploy` commands never call provision, so those fields were
   * empty and the emitted wrangler config silently lacked the D1 binding (or
   * carried `kv_namespaces: [{ id: "" }]`)  -  a worker deployed with no
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
   * resolve  -  Cloudflare has no API to create an Analytics Engine dataset
   * ahead of time, it materializes on the first `writeDataPoint()`. So
   * "provisioning" it is entirely this env-wiring in `build()`.
   */
  describe("build  -  analytics env wiring", () => {
    const buildCommand = "alepha build --runtime=workerd";

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

      // hasAnalytics: false  -  mirrors an app that only ever set the env var
      // by hand, the historical workaround this feature replaces.
      await adapter.build(makeCtx(naming), createMockRun());

      const call = shell.calls.find((c) => c.command === buildCommand);
      expect(call?.options.env?.CLOUDFLARE_ANALYTICS_DATASET).toBe(
        "sigil_analytics",
      );
    });
  });

  describe("secrets", () => {
    /**
     * Deploy the way `up()` does after `build`: a freshly generated config,
     * then the one upload, which carries the secrets (#Q2459, #Q2612).
     */
    const deployed = async (
      adapter: CloudflareAdapter,
      fs: MemoryFileSystemProvider,
      ctx: InfraContext<any>,
      run: ReturnType<typeof createMockRun>,
    ) => {
      await fs.writeFile(
        "/project/dist/wrangler.jsonc",
        JSON.stringify({ name: "acme-portal-production" }),
      );
      await adapter.deploy(ctx, run);
    };

    /**
     * What the last upload carried: the secrets it was handed as
     * `secret_text`, the config's `vars` as `plain_text`.
     */
    const sent = (
      fs: MemoryFileSystemProvider,
      worker: CapturingWorkerAdapter,
    ): Array<{ type: string; name: string; text: string }> => {
      const secrets = worker.uploads.at(-1)?.secrets ?? {};
      const config = JSON.parse(
        fs.getFileContent("/project/dist/wrangler.jsonc") ?? "{}",
      ) as { vars?: Record<string, string> };
      return [
        ...Object.entries(secrets).map(([name, text]) => ({
          type: "secret_text",
          name,
          text,
        })),
        ...Object.entries(config.vars ?? {}).map(([name, text]) => ({
          type: "plain_text",
          name,
          text,
        })),
      ];
    };

    test("pushes non-binding env vars via REST putSecret", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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
      await deployed(adapter, fs, ctx, run);

      const pushed = sent(fs, worker).filter((b) => b.type === "secret_text");
      const names = pushed.map((s) => s.name).sort();
      expect(names).toEqual(["APP_SECRET", "GOOGLE_API_KEY"]);
    });

    test("with platform.secrets.keys, resolves the allowlist from process.env (no .env file) and ignores ambient vars", async ({
      expect,
    }) => {
      const { adapter, alepha, fs, naming, worker } = createTestEnv();
      // Declare an explicit allowlist  -  the CI shape: secrets arrive via the
      // job environment, there is no .env.production on the runner.
      alepha.set(infraOptions, {
        secrets: { keys: ["APP_SECRET", "GOOGLE_CLIENT_ID", "EMAIL_FROM"] },
        environments: { production: cloudflare() },
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
        await deployed(adapter, fs, ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.AMBIENT_RUNNER_VAR;
      }

      const pushed = sent(fs, worker).filter((b) => b.type === "secret_text");
      const names = pushed.map((s) => s.name).sort();
      expect(names).toEqual(["APP_SECRET", "GOOGLE_CLIENT_ID"]);
    });

    test("with platform.secrets.keys, the .env file overrides process.env per key", async ({
      expect,
    }) => {
      const { adapter, alepha, fs, naming, worker } = createTestEnv();
      alepha.set(infraOptions, {
        secrets: { keys: ["APP_SECRET", "GOOGLE_CLIENT_ID"] },
        environments: { production: cloudflare() },
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
        await deployed(adapter, fs, ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
      }

      // Secret *values* land in the full binding set (api.bindings); the
      // api.secrets projection only keeps names.
      const bindings = sent(fs, worker);
      const byName = Object.fromEntries(
        bindings
          .filter((b) => b.type === "secret_text")
          .map((b) => [b.name, b.text]),
      );
      expect(byName.APP_SECRET).toBe("from-file");
      expect(byName.GOOGLE_CLIENT_ID).toBe("env-google");
    });

    test("uses dist/manifest.json `secrets` and `variables` as the default allowlist, resolved from process.env", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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
          secrets: [
            { name: "APP_SECRET" },
            { name: "GOOGLE_CLIENT_ID" },
            { name: "HYPERDRIVE_ID" },
            { name: "LOG_LEVEL" },
          ],
          variables: [],
        }),
      );

      process.env.APP_SECRET = "s1";
      process.env.GOOGLE_CLIENT_ID = "g1";
      process.env.HYPERDRIVE_ID = "hd-1"; // declared but EXCLUDED
      // LOG_LEVEL is declared + ambient in the runner, but EXCLUDED (infra knob).
      try {
        const run = createMockRun();
        await deployed(adapter, fs, ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.HYPERDRIVE_ID;
      }

      const pushed = sent(fs, worker).filter((b) => b.type === "secret_text");
      expect(pushed.map((s) => s.name).sort()).toEqual([
        "APP_SECRET",
        "GOOGLE_CLIENT_ID",
      ]);
    });

    test("pushes per-deploy keys from .env.<env>.local even when not in the manifest", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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
        JSON.stringify({ secrets: [{ name: "APP_SECRET" }], variables: [] }),
      );
      // …but an orchestrator (Rocket) injected CLUB_CONFIG_JSON into the
      // per-deploy override file. It must still be pushed.
      await fs.writeFile(
        "/project/.env.production.local",
        ["APP_SECRET=s1", 'CLUB_CONFIG_JSON={"id":"b14"}', ""].join("\n"),
      );

      const run = createMockRun();
      await deployed(adapter, fs, ctx, run);

      const pushed = sent(fs, worker).filter((b) => b.type === "secret_text");
      expect(pushed.map((s) => s.name).sort()).toEqual([
        "APP_SECRET",
        "CLUB_CONFIG_JSON",
      ]);
    });

    test("platform.secrets.keys overrides the manifest `env` allowlist", async ({
      expect,
    }) => {
      const { adapter, alepha, fs, naming, worker } = createTestEnv();
      alepha.set(infraOptions, {
        secrets: { keys: ["APP_SECRET"] }, // narrow override
        environments: { production: cloudflare() },
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
        JSON.stringify({
          secrets: [{ name: "APP_SECRET" }, { name: "GOOGLE_CLIENT_ID" }],
          variables: [],
        }),
      );

      process.env.APP_SECRET = "s1";
      process.env.GOOGLE_CLIENT_ID = "g1";
      try {
        const run = createMockRun();
        await deployed(adapter, fs, ctx, run);
      } finally {
        delete process.env.APP_SECRET;
        delete process.env.GOOGLE_CLIENT_ID;
      }

      const pushed = sent(fs, worker).filter((b) => b.type === "secret_text");
      expect(pushed.map((s) => s.name)).toEqual(["APP_SECRET"]);
    });

    test("auto-derives PUBLIC_URL from the configured domain", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
      const ctx = makeCtx(naming, {
        options: { domain: "lore.alepha.dev" },
      });

      await fs.writeFile(
        "/project/.env.production",
        ["APP_SECRET=my-secret", ""].join("\n"),
      );

      const run = createMockRun();
      await deployed(adapter, fs, ctx, run);

      const bindings = sent(fs, worker);
      const publicUrl = bindings.find((b) => b.name === "PUBLIC_URL");
      expect(publicUrl?.text).toBe("https://lore.alepha.dev");
    });

    test("honors an explicit PUBLIC_URL over the derived one", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
      const ctx = makeCtx(naming, {
        options: { domain: "lore.alepha.dev" },
      });

      await fs.writeFile(
        "/project/.env.production",
        ["PUBLIC_URL=https://custom.example.com", ""].join("\n"),
      );

      const run = createMockRun();
      await deployed(adapter, fs, ctx, run);

      const bindings = sent(fs, worker);
      const publicUrl = bindings.find((b) => b.name === "PUBLIC_URL");
      expect(publicUrl?.text).toBe("https://custom.example.com");
    });

    test("skips when no env file exists", async ({ expect }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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
      await deployed(adapter, fs, ctx, run);

      expect(sent(fs, worker)).toEqual([]);
    });

    test("skips comments and empty lines", async ({ expect }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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
      await deployed(adapter, fs, ctx, run);

      const pushed = sent(fs, worker).filter((b) => b.type === "secret_text");
      expect(pushed.map((s) => s.name)).toEqual(["ONLY_SECRET"]);
    });

    test("pushes manifest `variables` as plain_text, everything else encrypted", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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
          secrets: [{ name: "APP_SECRET" }, { name: "SIGIL_KEY" }],
          variables: [{ name: "SIGIL_CONFIG" }],
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

      await deployed(adapter, fs, ctx, createMockRun());

      const bindings = sent(fs, worker);
      const byName = Object.fromEntries(bindings.map((b) => [b.name, b]));

      // Declassified → readable and editable in the dashboard.
      expect(byName.SIGIL_CONFIG?.type).toBe("plain_text");
      expect(byName.SIGIL_CONFIG?.text).toBe('{"project":"demo"}');

      // Everything not on the list stays encrypted  -  including the key that
      // sits right next to it in the same module.
      expect(byName.SIGIL_KEY?.type).toBe("secret_text");
      expect(byName.APP_SECRET?.type).toBe("secret_text");
    });

    test("does not declassify a key the app never vouched for", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
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

      // An app that declassified nothing: every key must be encrypted.
      await fs.writeFile(
        "/project/dist/manifest.json",
        JSON.stringify({
          secrets: [{ name: "APP_SECRET" }, { name: "SIGIL_CONFIG" }],
          variables: [],
        }),
      );
      await fs.writeFile(
        "/project/.env.production",
        ["APP_SECRET=my-secret", 'SIGIL_CONFIG={"project":"demo"}'].join("\n"),
      );

      await deployed(adapter, fs, ctx, createMockRun());

      const bindings = sent(fs, worker);
      expect(bindings.every((b) => b.type === "secret_text")).toBe(true);
    });

    test("pushes the auto-derived PUBLIC_URL as plain_text", async ({
      expect,
    }) => {
      const { adapter, fs, naming, worker } = createTestEnv();
      const ctx = makeCtx(naming, {
        options: { domain: "lore.alepha.dev" },
      });

      // No manifest at all: PUBLIC_URL is invented by the adapter from the
      // configured domain, so it can never appear on `variables`. It is
      // plaintext regardless  -  it is the address the app answers on.
      await fs.writeFile("/project/.env.production", "APP_SECRET=my-secret");

      await deployed(adapter, fs, ctx, createMockRun());

      const bindings = sent(fs, worker);
      const publicUrl = bindings.find((b) => b.name === "PUBLIC_URL");
      expect(publicUrl?.type).toBe("plain_text");
      expect(publicUrl?.text).toBe("https://lore.alepha.dev");
      expect(bindings.find((b) => b.name === "APP_SECRET")?.type).toBe(
        "secret_text",
      );
    });

    describe("one upload (#Q2459)", () => {
      /**
       * The secrets used to follow the upload as a settings PATCH: a second
       * Worker version on every `up`, and a window in which the new build ran
       * against the previous secret set, or, on a first deploy, with none.
       */
      test("a first deploy sends its secrets in the one upload, from dist/, and nothing after", async ({
        expect,
      }) => {
        const { adapter, fs, naming, worker, shell } = createTestEnv();
        const ctx = makeCtx(naming);
        await fs.writeFile(
          "/project/.env.production",
          ["APP_SECRET=s1", "GOOGLE_API_KEY=g1"].join("\n"),
        );

        await deployed(adapter, fs, ctx, createMockRun());

        expect(worker.uploads).toHaveLength(1);
        expect(worker.uploads[0]).toEqual({
          root: "/project/dist",
          secrets: { APP_SECRET: "s1", GOOGLE_API_KEY: "g1" },
          apiToken: "test-token",
        });
        // No wrangler process, and no secret ever written to a file.
        expect(shell.calls).toEqual([]);
        expect(
          fs.writeFileCalls.some((it) => it.path.includes("secrets")),
        ).toBe(false);
        await expect(adapter.secrets(ctx, createMockRun())).resolves.toBe(
          undefined,
        );
      });

      test("a redeploy carries a rotated value in the same single upload", async ({
        expect,
      }) => {
        const { adapter, fs, naming, worker } = createTestEnv();
        const ctx = makeCtx(naming);

        await fs.writeFile("/project/.env.production", "APP_SECRET=v1");
        await deployed(adapter, fs, ctx, createMockRun());
        await fs.writeFile("/project/.env.production", "APP_SECRET=v2");
        await deployed(adapter, fs, ctx, createMockRun());

        expect(worker.uploads).toHaveLength(2);
        expect(sent(fs, worker)).toEqual([
          { type: "secret_text", name: "APP_SECRET", text: "v2" },
        ]);
      });

      test("a key declassified since the last deploy leaves the secrets file for the config vars", async ({
        expect,
      }) => {
        const { adapter, fs, naming, worker } = createTestEnv();
        const ctx = makeCtx(naming);
        await fs.writeFile(
          "/project/dist/manifest.json",
          JSON.stringify({
            secrets: [{ name: "APP_SECRET" }, { name: "SIGIL_CONFIG" }],
            variables: [],
          }),
        );
        await fs.writeFile(
          "/project/.env.production",
          ["APP_SECRET=s1", 'SIGIL_CONFIG={"project":"demo"}'].join("\n"),
        );
        await deployed(adapter, fs, ctx, createMockRun());
        expect(
          sent(fs, worker).find((b) => b.name === "SIGIL_CONFIG")?.type,
        ).toBe("secret_text");

        await fs.writeFile(
          "/project/dist/manifest.json",
          JSON.stringify({
            secrets: [{ name: "APP_SECRET" }],
            variables: [{ name: "SIGIL_CONFIG" }],
          }),
        );
        await deployed(adapter, fs, ctx, createMockRun());

        const after = sent(fs, worker);
        expect(after.filter((b) => b.name === "SIGIL_CONFIG")).toEqual([
          {
            type: "plain_text",
            name: "SIGIL_CONFIG",
            text: '{"project":"demo"}',
          },
        ]);
      });

      test("keeps the vars the build wrote, with the explicit value on top", async ({
        expect,
      }) => {
        const { adapter, fs, naming } = createTestEnv();
        const ctx = makeCtx(naming, {
          options: { domain: "lore.alepha.dev" },
        });
        await fs.writeFile(
          "/project/dist/wrangler.jsonc",
          JSON.stringify({
            name: "acme-portal-production",
            vars: { BUILT: "kept", PUBLIC_URL: "https://stale.example" },
          }),
        );

        await adapter.deploy(ctx, createMockRun());

        const config = JSON.parse(
          fs.getFileContent("/project/dist/wrangler.jsonc") as string,
        );
        expect(config.vars).toEqual({
          BUILT: "kept",
          PUBLIC_URL: "https://lore.alepha.dev",
        });
      });
    });

    /**
     * Cloudflare keeps a secret the upload does not name, as
     * `wrangler deploy --secrets-file` did (measured live for #Q2612). A
     * secret the environment stopped declaring, or one set by hand in the
     * dashboard, stays bound - so it is named on every deploy.
     */
    describe("undeclared secrets", () => {
      test("names every secret the Worker keeps that the environment no longer declares", async ({
        expect,
      }) => {
        const { adapter, fs, naming } = createTestEnv();
        const ctx = makeCtx(naming, { options: { domain: "acme.dev" } });
        await fs.writeFile(
          "/project/dist/wrangler.jsonc",
          JSON.stringify({ vars: { SIGIL_CONFIG: "{}" } }),
        );
        const probe = adapter as unknown as ArtifactReadyCloudflareAdapter;
        probe.memory.secrets.set("acme-portal-production", [
          { name: "APP_SECRET", type: "secret_text" },
          { name: "HAND_SET", type: "secret_text" },
          { name: "OLD_KEY", type: "secret_text" },
          // Now a plain var, and still on the Worker: not removed.
          { name: "SIGIL_CONFIG", type: "secret_text" },
          // Derived from the domain by the upload itself.
          { name: "PUBLIC_URL", type: "secret_text" },
        ]);

        const undeclared = await probe.undeclaredSecrets(
          ctx,
          { apiToken: "t", accountId: "a" },
          { APP_SECRET: "s1" },
          "/project/dist/wrangler.jsonc",
        );

        expect(undeclared).toEqual(["HAND_SET", "OLD_KEY"]);
      });

      test("a Worker that cannot be listed has nothing to report, and the deploy goes on", async ({
        expect,
      }) => {
        const { adapter, fs, naming, worker } = createTestEnv();
        const probe = adapter as unknown as ArtifactReadyCloudflareAdapter;
        Object.assign(probe, {
          provisioner: () => ({
            listSecrets: async () => {
              throw new Error("workers.api.error.script_not_found");
            },
          }),
        });
        await fs.writeFile("/project/.env.production", "APP_SECRET=s1");

        await deployed(adapter, fs, makeCtx(naming), createMockRun());

        expect(worker.uploads).toHaveLength(1);
      });
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
      expect(api.deletedWorkers).toEqual(["acme-portal-production"]);
    });

    test("unbinds the consumer, then deletes the queue and its dead-letter queue", async ({
      expect,
    }) => {
      const { adapter, naming, api } = createTestEnv();
      const ctx = makeCtx(naming, {
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: true,
          hasCron: false,
        },
      });
      await adapter.provision(ctx, createMockRun());

      const state = await adapter.inspect(ctx, createMockRun());
      expect(state.queues).toEqual([
        {
          name: "acme-portal-production",
          exists: true,
          id: "q-acme-portal-production-id",
        },
        {
          name: "acme-portal-production-dlq",
          exists: true,
          id: "q-acme-portal-production-dlq-id",
        },
      ]);

      await adapter.teardown(ctx, createMockRun());

      expect(api.unbound).toEqual([
        {
          queueId: "q-acme-portal-production-id",
          script: "acme-portal-production",
        },
      ]);
      expect(api.queues).toEqual([]);
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
      // Staged, not written straight into the snapshot  -  see below.
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
