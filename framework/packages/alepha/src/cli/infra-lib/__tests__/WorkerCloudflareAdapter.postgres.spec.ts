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
      .with({ provide: D1MigrationsService, use: RecordingD1Migrations });
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
      adapter: alepha.inject(WorkerCloudflareAdapter),
      postgres: alepha.inject(RecordingPostgresMigrations),
      d1: alepha.inject(RecordingD1Migrations),
      ctx,
    };
  };

  const run = Object.assign(
    async (task: { handler: () => Promise<void> }) => {
      await task.handler();
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
});
