import { $inject, Alepha, AlephaError, type ZType } from "alepha";
import { ActorHostRegistry } from "alepha/actor";
import type { RunnerMethod } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { WebSocketHost } from "alepha/websocket";
import { describe, it } from "vitest";

import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import type { InfraContext } from "../adapters/InfraAdapter.ts";
import { WorkerCloudflareAdapter } from "../adapters/WorkerCloudflareAdapter.ts";
import { CloudflareApi } from "../services/CloudflareApi.ts";
import {
  CloudflareDeployClient,
  type CloudflareDeployPlan,
} from "../services/CloudflareDeployClient.ts";
import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";
import { DurableObjectLifecycle } from "../services/DurableObjectLifecycle.ts";
import { NamingService } from "../services/NamingService.ts";
import { WranglerApi } from "../services/WranglerApi.ts";

class RecordedProvisioner extends CloudflareProvisionClient {
  public tag?: string;
  public refused = false;
  public deleted: string[] = [];
  public override async getWorkerMigrationTag(): Promise<string | undefined> {
    if (this.refused) throw new AlephaError("lookup refused");
    return this.tag;
  }
  public override async deleteWorker(name: string): Promise<void> {
    if (this.refused) throw new AlephaError("delete refused");
    this.deleted.push(name);
  }
}
class RecordedDeployClient extends CloudflareDeployClient {
  public plans: CloudflareDeployPlan[] = [];
  public override async deploy(plan: CloudflareDeployPlan) {
    this.plans.push(plan);
    return { versionId: "recorded" };
  }
  public override async getSubdomain() {
    return "fixture";
  }
}
class RecordedWorkerAdapter extends WorkerCloudflareAdapter {
  public readonly recording = new RecordedDeployClient({
    apiToken: "fixture",
    accountId: "fixture",
  });
  public readonly source = new RecordedProvisioner({
    apiToken: "fixture",
    accountId: "fixture",
  });
  protected override deployer() {
    return this.recording;
  }
  protected override provisioner() {
    return this.source;
  }
}
class RecordedWrangler extends WranglerApi {
  protected readonly fs = $inject(FileSystemProvider);
  public configs: any[] = [];
  public override async deploy(_name: string, path: string) {
    this.configs.push(await this.fs.readJsonFile(path));
    return "https://fixture.workers.dev";
  }
}
class RecordedApi extends CloudflareApi {
  public tag?: string;
  public refused = false;
  public paths: string[] = [];
  public override async getWorkerMigrationTag() {
    if (this.refused) throw new AlephaError("lookup refused");
    return this.tag;
  }
}
class MetadataApi extends CloudflareApi {
  public rows: unknown[] = [];
  public refused = false;
  public path = "";
  protected override async paginate<T>(
    path: string,
    _schema: ZType,
  ): Promise<T[]> {
    this.path = path;
    if (this.refused) throw new AlephaError("permission refused");
    return this.rows as T[];
  }
}
class MetadataProvisioner extends CloudflareProvisionClient {
  public rows: unknown[] = [];
  public refused = false;
  public path = "";
  protected override async paginate<T>(path: string): Promise<T[]> {
    this.path = path;
    if (this.refused) throw new AlephaError("permission refused");
    return this.rows as T[];
  }
}

describe("Durable Object deployment", () => {
  const runner = Object.assign(
    async (task: any) => {
      for (const item of Array.isArray(task) ? task : [task])
        await item.handler();
    },
    { end: () => {} },
  ) as unknown as RunnerMethod;
  const setup = () => {
    const app = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: CloudflareApi, use: RecordedApi })
      .with({ provide: WranglerApi, use: RecordedWrangler });
    return {
      app,
      fs: app.inject(MemoryFileSystemProvider),
      naming: app.inject(NamingService),
    };
  };
  const context = (
    naming: NamingService,
    root: string,
    combined = false,
  ): InfraContext<any> => ({
    project: "actor-fixture",
    env: "test",
    options: {},
    root,
    prebuilt: true,
    entry: { root, server: "" },
    naming: naming.forContext("actor-fixture", "test"),
    resources: {
      hasDatabase: false,
      hasBucket: false,
      hasAnalytics: false,
      hasKV: false,
      hasQueue: false,
      hasCron: false,
      hasWebSocket: combined,
      hasDurableObjects: true,
    },
  });
  const manifest = (
    ctx: InfraContext<any>,
    config?: Record<string, unknown>,
  ) => ({
    project: ctx.project,
    runtimes: [{ runtime: "workerd", entry: "index.workerd.js" }],
    resources: ctx.resources,
    crons: [],
    secrets: [],
    variables: [],
    cloudflare: {
      config,
      websocketPaths: ctx.resources.hasWebSocket ? ["/ws/fixture"] : [],
      durableObjects: ctx.resources.hasWebSocket
        ? [ActorHostRegistry.actor, WebSocketHost.declaration]
        : [ActorHostRegistry.actor],
    },
  });

  const localArtifact = async (fs: MemoryFileSystemProvider, data: unknown) => {
    await fs.writeFile("/local/dist/manifest.json", JSON.stringify(data));
    await fs.writeFile("/local/dist/index.workerd.js", "export default {};");
    await fs.writeFile("/local/dist/main.cloudflare.js", "export default {};");
  };

  for (const combined of [false, true])
    it(`carries ${combined ? "combined" : "actor-only"} prebuilt declarations through both adapters`, async ({
      expect,
    }) => {
      const { app, fs, naming } = setup();
      const worker = app
        .inject(RecordedWorkerAdapter)
        .use({ apiToken: "fixture", accountId: "fixture" });
      const local = app.inject(CloudflareAdapter);
      const workerCtx = context(naming, "/worker", combined);
      const localCtx = context(naming, "/local", combined);
      const data = manifest(workerCtx);
      await fs.writeFile("/worker/manifest.json", JSON.stringify(data));
      await fs.writeFile("/worker/index.workerd.js", "export default {};");
      await fs.writeFile("/local/dist/manifest.json", JSON.stringify(data));
      await worker.build(workerCtx, runner);
      await local.build(localCtx, runner);
      await localArtifact(fs, data);
      await worker.deploy(workerCtx, runner);
      await local.deploy(localCtx, runner);
      const plan = worker.recording.plans[0];
      const config = app.inject(RecordedWrangler).configs[0];
      expect(plan.exports).toEqual(config.exports);
      expect(plan.migrations).toBeUndefined();
      expect(config.migrations).toBeUndefined();
      expect(
        plan.bindings?.filter(
          (item) => item.type === "durable_object_namespace",
        ),
      ).toEqual(
        config.durable_objects.bindings.map((binding: any) => ({
          type: "durable_object_namespace",
          ...binding,
        })),
      );
      expect(
        plan.bindings?.find((item) => item.name === "ALEPHA_ACTOR"),
      ).not.toHaveProperty("namespace_id");
      expect(worker.provisionedResources.durableObjects).toBe(true);
      worker.source.refused = true;
      const failed = await worker.teardownRecorded({
        worker: "actor-fixture-test",
        durableObjects: true,
      });
      expect(failed.failed[0].resource).toBe("worker");
      expect(failed.removed).not.toContain("durableObjects");
      worker.source.refused = false;
      const removed = await worker.teardownRecorded({
        worker: "actor-fixture-test",
        durableObjects: true,
      });
      expect(removed.removed).toEqual(["worker", "durableObjects"]);
      expect(worker.source.deleted).toEqual(["actor-fixture-test"]);
    });

  it("sends ordered legacy steps once, appends the actor class and refuses unknown tags or failed lookups", async ({
    expect,
  }) => {
    const { app, fs, naming } = setup();
    const worker = app
      .inject(RecordedWorkerAdapter)
      .use({ apiToken: "fixture", accountId: "fixture" });
    const ctx = context(naming, "/worker", true);
    const history = [
      { tag: "original", new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
    ];
    await fs.writeFile(
      "/worker/manifest.json",
      JSON.stringify(manifest(ctx, { migrations: history })),
    );
    await fs.writeFile("/worker/index.workerd.js", "export default {};");
    await worker.build(ctx, runner);
    const config = await fs.readJsonFile<any>("/worker/wrangler.jsonc");
    expect(config.exports).toBeUndefined();
    expect(config.migrations[0]).toEqual(history[0]);
    await worker.deploy(ctx, runner);
    expect(worker.recording.plans.at(-1)?.migrations).toEqual({
      new_tag: "alepha-hosts-v1",
      steps: [
        { new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
        { new_sqlite_classes: ["AlephaActorDurableObject"] },
      ],
    });
    worker.source.tag = "original";
    await worker.deploy(ctx, runner);
    expect(worker.recording.plans.at(-1)?.migrations).toEqual({
      old_tag: "original",
      new_tag: "alepha-hosts-v1",
      steps: [{ new_sqlite_classes: ["AlephaActorDurableObject"] }],
    });
    worker.source.tag = "alepha-hosts-v1";
    await worker.deploy(ctx, runner);
    expect(worker.recording.plans.at(-1)?.migrations).toBeUndefined();
    const before = worker.recording.plans.length;
    worker.source.tag = "lost";
    await expect(worker.deploy(ctx, runner)).rejects.toThrow(
      "missing from the supplied history",
    );
    worker.source.refused = true;
    await expect(worker.deploy(ctx, runner)).rejects.toThrow("lookup refused");
    expect(worker.recording.plans.length).toBe(before);

    await fs.writeFile("/local/dist/wrangler.jsonc", JSON.stringify(config));
    await localArtifact(fs, manifest(context(naming, "/local", true)));
    const local = app.inject(CloudflareAdapter);
    const api = app.inject(RecordedApi);
    api.tag = "lost";
    await expect(
      local.deploy(context(naming, "/local", true), runner),
    ).rejects.toThrow("missing from the supplied history");
    api.tag = "original";
    await local.deploy(context(naming, "/local", true), runner);
    expect(app.inject(RecordedWrangler).configs[0].migrations).toEqual(
      config.migrations,
    );
    api.refused = true;
    await expect(
      local.deploy(context(naming, "/local", true), runner),
    ).rejects.toThrow("lookup refused");
    expect(app.inject(RecordedWrangler).configs.length).toBe(1);
  });

  it("preserves supported external fields and rejects mixed lifecycle configuration before upload", async ({
    expect,
  }) => {
    const lifecycle = new DurableObjectLifecycle();
    const binding = {
      name: "EXTERNAL",
      class_name: "Remote",
      script_name: "other",
      environment: "production",
      namespace_id: "known",
      dispatch_namespace: "dispatch",
      retry: { max_attempts: 2, timeout_ms: 100 },
    };
    expect(
      lifecycle.bindings({ durable_objects: { bindings: [binding] } }),
    ).toEqual([{ type: "durable_object_namespace", ...binding }]);
    expect(() =>
      lifecycle.bindings({ durable_objects: { bindings: [binding, binding] } }),
    ).toThrow("duplicate");
    const { app, fs, naming } = setup();
    const config = {
      main: "./main.cloudflare.js",
      migrations: [],
      exports: { Actor: { type: "durable-object", storage: "sqlite" } },
    };
    await fs.writeFile("/worker/wrangler.jsonc", JSON.stringify(config));
    await fs.writeFile("/local/dist/wrangler.jsonc", JSON.stringify(config));
    await localArtifact(fs, manifest(context(naming, "/local", true)));
    const worker = app
      .inject(RecordedWorkerAdapter)
      .use({ apiToken: "fixture", accountId: "fixture" });
    await expect(
      worker.deploy(context(naming, "/worker"), runner),
    ).rejects.toThrow("mutually exclusive");
    await expect(
      app.inject(CloudflareAdapter).deploy(context(naming, "/local"), runner),
    ).rejects.toThrow("mutually exclusive");
    expect(worker.recording.plans).toEqual([]);
    expect(app.inject(RecordedWrangler).configs).toEqual([]);
  });

  it("reads migration tags from successful metadata and propagates permission failures on both clients", async ({
    expect,
  }) => {
    const api = Alepha.create().inject(MetadataApi);
    api.setAccountId("fixture");
    const provisioner = new MetadataProvisioner({
      apiToken: "fixture",
      accountId: "fixture",
    });
    for (const client of [api, provisioner]) {
      client.rows = [{ id: "worker", migration_tag: "v2" }];
      expect(await client.getWorkerMigrationTag("worker")).toBe("v2");
      expect(await client.getWorkerMigrationTag("new")).toBeUndefined();
      expect(client.path).toBe("/accounts/fixture/workers/scripts");
      client.refused = true;
      await expect(client.getWorkerMigrationTag("worker")).rejects.toThrow(
        "permission refused",
      );
    }
  });
});
