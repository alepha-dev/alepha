import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import type { PlatformContext } from "../adapters/PlatformAdapter.ts";
import { WorkerCloudflareAdapter } from "../adapters/WorkerCloudflareAdapter.ts";
import { NamingService } from "../services/NamingService.ts";

/**
 * The adapter that lets `orchestrator.up()` run inside a Worker.
 *
 * ⚠️ **The order is the whole of it.** A packed `wrangler.jsonc` carries no
 * `d1_databases`, no `r2_buckets` and no `vars`, deliberately (folio #F1209),
 * so provisioning has to run BEFORE the config is regenerated and the ids it
 * obtained are what the build reads. Uploading the packed config instead is the
 * implementation that looks right and produces a Worker with no database.
 */
describe("the worker-side Cloudflare adapter", () => {
  const setup = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      alepha,
      fs: alepha.inject(MemoryFileSystemProvider),
      adapter: alepha.inject(WorkerCloudflareAdapter),
      naming: alepha.inject(NamingService),
    };
  };

  const context = (
    naming: NamingService,
    resources: Partial<PlatformContext["resources"]> = {},
  ): PlatformContext =>
    ({
      project: "my-app",
      env: "staging",
      envConfig: { adapter: "cloudflare" },
      root: "/deploy",
      entry: { root: "/deploy", server: "" },
      naming: naming.forContext("my-app", "staging"),
      resources: {
        hasDatabase: false,
        hasBucket: false,
        hasAnalytics: false,
        hasKV: false,
        hasQueue: false,
        hasCron: false,
        ...resources,
      },
    }) as PlatformContext;

  const run = Object.assign(
    (task: { handler: () => Promise<void> }) => task.handler(),
    { end: () => {} },
  ) as never;

  const credential = { apiToken: "estate-token", accountId: "estate-account" };

  it("refuses to do anything without the estate's credential", async ({
    expect,
  }) => {
    // ⚠️ There is deliberately no environment fallback:
    // `CLOUDFLARE_ACCOUNT_ID` inside Lore's Worker is Lore's OWN account, so a
    // fallback would create a user's database in the operator's and bill it to
    // them.
    const { adapter } = setup();

    await expect(adapter.authenticate()).rejects.toThrowError(
      /has no Cloudflare credential/,
    );
  });

  it("provisions what the app binds, and nothing it does not", async ({
    expect,
  }) => {
    const { adapter, naming } = setup();
    const calls: string[] = [];
    const provisioner = {
      ensureD1: async (name: string) => {
        calls.push(`d1:${name}`);
        return { uuid: "db-uuid", name };
      },
      ensureR2: async (name: string) => {
        calls.push(`r2:${name}`);
      },
      ensureKV: async (title: string) => {
        calls.push(`kv:${title}`);
        return { id: "kv-id", title };
      },
      ensureQueue: async (name: string) => {
        calls.push(`queue:${name}`);
        return { queue_id: "q", queue_name: name };
      },
    };
    Object.assign(adapter as unknown as Record<string, unknown>, {
      credential,
      provisioner: () => provisioner,
    });

    await adapter.provision(
      context(naming, { hasDatabase: true, hasQueue: true }),
      run,
    );

    // A bucket and a namespace the app does not bind are not created: an
    // empty R2 bucket in somebody's account is a bill and a surprise.
    expect(calls).toEqual([
      "d1:my-app-staging",
      "queue:my-app-staging",
      // The dead-letter queue is a real queue, and a consumer naming one
      // Cloudflare does not have is refused at bind time.
      "queue:my-app-staging-dlq",
    ]);
  });

  it("hands the build the ids it just provisioned, and only those", async ({
    expect,
  }) => {
    // The folio #F1209 order, asserted. `ctx.env` present means it is the
    // WHOLE environment, so a deploy cannot inherit Lore's own DATABASE_URL
    // for a database it never made.
    const { adapter, fs, naming } = setup();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      credential,
      provisioner: () => ({
        ensureD1: async (name: string) => ({ uuid: "db-uuid", name }),
        ensureR2: async () => {},
      }),
    });
    await fs.writeFile(
      "/deploy/dist/manifest.json",
      JSON.stringify({ version: 1, runtime: "workerd", project: "my-app" }),
    );

    const ctx = context(naming, { hasDatabase: true, hasBucket: true });
    await adapter.provision(ctx, run);

    let seen: Record<string, string> | undefined;
    Object.assign(adapter as unknown as Record<string, unknown>, {
      buildTask: {
        run: async (built: { env: Record<string, string> }) => {
          seen = built.env;
        },
      },
    });
    await adapter.build(ctx, run);

    expect(seen).toEqual({
      DATABASE_URL: "d1://my-app-staging:db-uuid",
      R2_BUCKET_NAME: "my-app-staging",
    });
  });

  it("says where to run inspect and teardown instead of half-answering", async ({
    expect,
  }) => {
    // A `plan` that reported an empty environment as empty would be worse than
    // one that refused: both look like "nothing is deployed".
    const { adapter } = setup();

    await expect(adapter.inspect()).rejects.toThrowError(/does not inspect/);
    await expect(adapter.teardown()).rejects.toThrowError(/does not tear down/);
  });
});
