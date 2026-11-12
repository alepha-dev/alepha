import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import type { InfraContext } from "../adapters/InfraAdapter.ts";
import { WorkerCloudflareAdapter } from "../adapters/WorkerCloudflareAdapter.ts";
import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";
import { D1MigrationsService } from "../services/D1MigrationsService.ts";
import { NamingService } from "../services/NamingService.ts";
import { PostgresMigrationsService } from "../services/PostgresMigrationsService.ts";

/**
 * Records what it was asked to apply instead of connecting: the migrator
 * itself is `PostgresMigrationsService.spec.ts`, against a real server.
 */
class RecordingPostgresMigrations extends PostgresMigrationsService {
  public calls: Array<{ url: string; schema?: string; root?: string }> = [];

  public override async apply(options: {
    url: string;
    schema?: string;
    root?: string;
  }): Promise<number> {
    this.calls.push(options);
    return 3;
  }
}

/**
 * The account, in memory: what `provision` and `teardownRecorded` asked of
 * Hyperdrive and D1. The HTTP shapes are
 * `CloudflareProvisionClient.hyperdrive.spec.ts`.
 */
class MemoryProvision extends CloudflareProvisionClient {
  public calls: string[] = [];

  constructor() {
    super({ apiToken: "t", accountId: "a" });
  }

  public override async ensureHyperdrive(
    name: string,
    url: string,
    options: { knownId?: string; adoptByName?: boolean } = {},
  ) {
    this.calls.push(
      `ensureHyperdrive ${name} ${new URL(url).hostname} known=${options.knownId ?? "-"} adopt=${options.adoptByName}`,
    );
    return { id: options.knownId ?? "hd-new", name, origin: { host: "h" } };
  }

  public override async ensureD1(name: string) {
    this.calls.push(`ensureD1 ${name}`);
    return { uuid: "d1-id", name } as never;
  }

  public override async deleteHyperdrive(id: string) {
    this.calls.push(`deleteHyperdrive ${id}`);
  }
}

class TestAdapter extends WorkerCloudflareAdapter {
  public readonly memory = new MemoryProvision();

  protected override provisioner() {
    return this.memory;
  }

  public testBuildEnv() {
    return this.buildEnv();
  }
}

class RecordingD1Migrations extends D1MigrationsService {
  public applied = 0;

  public override async apply(): Promise<number> {
    this.applied++;
    return 1;
  }
}

/**
 * A prebuilt deploy whose instance holds a Postgres `DATABASE_URL` migrates
 * the artifact's migrations/postgres/ in process, and reports the count as
 * the D1 path does (#Q3508).
 */
describe("the worker-side Cloudflare adapter on Postgres", () => {
  const setup = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({
        provide: PostgresMigrationsService,
        use: RecordingPostgresMigrations,
      })
      .with({ provide: D1MigrationsService, use: RecordingD1Migrations })
      .with({ provide: WorkerCloudflareAdapter, use: TestAdapter });
    const naming = alepha.inject(NamingService);
    const ctx = {
      project: "my-app",
      env: "production",
      options: {},
      root: "/deploy",
      entry: { root: "/deploy", server: "" },
      naming: naming.forContext("my-app", "production"),
      resources: {
        hasDatabase: true,
        hasBucket: false,
        hasAnalytics: false,
        hasKV: false,
        hasQueue: false,
        hasCron: false,
      },
    } as unknown as InfraContext<any>;
    return {
      adapter: alepha.inject(WorkerCloudflareAdapter) as TestAdapter,
      postgres: alepha.inject(RecordingPostgresMigrations),
      d1: alepha.inject(RecordingD1Migrations),
      ctx,
    };
  };

  type Task = { handler: () => Promise<void> };
  const run = Object.assign(
    async (task: Task | Task[]) => {
      for (const it of Array.isArray(task) ? task : [task]) {
        await it.handler();
      }
    },
    { rm: async () => "", cp: async () => "", end: () => {} },
  ) as never;

  it("applies migrations/postgres with the instance's URL and schema, and reports the count", async ({
    expect,
  }) => {
    const { adapter, postgres, d1, ctx } = setup();
    adapter.withSecrets({
      DATABASE_URL: "postgresql://app:pw@db.example.app:5432/app",
      POSTGRES_SCHEMA: "acme",
    });

    await adapter.migrate(ctx, run);

    expect(postgres.calls).toEqual([
      {
        url: "postgresql://app:pw@db.example.app:5432/app",
        schema: "acme",
        root: "/deploy",
      },
    ]);
    expect(d1.applied).toBe(0);
    expect(adapter.migrationsApplied).toBe(3);
  });

  it("stays on D1 when the instance holds no Postgres URL", async ({
    expect,
  }) => {
    const { adapter, postgres, d1, ctx } = setup();
    adapter
      .use({ apiToken: "token", accountId: "account" } as never)
      .withSecrets({ API_KEY: "k" });

    await adapter.migrate(ctx, run);

    expect(postgres.calls).toEqual([]);
    expect(d1.applied).toBe(1);
  });

  it("provisions Hyperdrive instead of D1 on a Postgres instance, and records it", async ({
    expect,
  }) => {
    const { adapter, ctx } = setup();
    const name = ctx.naming.hyperdrive();
    adapter
      .use({ apiToken: "t", accountId: "a" })
      .withKnownResources({ hyperdrive: { name, id: "hd-recorded" } })
      .withSecrets({
        DATABASE_URL: "postgres://app:pw@db.example.app/app",
        POSTGRES_SCHEMA: "acme",
      });

    await adapter.provision(ctx, run);

    // The recorded config is the one updated; no D1 is created.
    expect(adapter.memory.calls).toEqual([
      `ensureHyperdrive ${name} db.example.app known=hd-recorded adopt=false`,
    ]);
    const env = adapter.testBuildEnv();
    expect(env.HYPERDRIVE_ID).toBe("hd-recorded");
    expect(env.POSTGRES_SCHEMA).toBe("acme");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(adapter.provisionedResources.hyperdrive).toEqual({
      name,
      id: "hd-recorded",
    });
    expect(adapter.provisionedResources.d1).toBeUndefined();
  });

  it("deletes the recorded Hyperdrive config at teardown, never the database", async ({
    expect,
  }) => {
    const { adapter } = setup();
    adapter.use({ apiToken: "t", accountId: "a" });

    const result = await adapter.teardownRecorded({
      hyperdrive: { name: "my-app-production", id: "hd-1" },
    });

    expect(adapter.memory.calls).toEqual(["deleteHyperdrive hd-1"]);
    expect(result.removed).toEqual(["hyperdrive"]);
    expect(result.kept).toEqual([]);
  });
});
