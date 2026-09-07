import { Alepha } from "alepha";
import { WorkerCloudflareAdapter } from "alepha/cli/platform-lib";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreApi } from "../src/api/index.ts";
import { DeployRegistry } from "../src/api/services/DeployRegistry.ts";
import { DeployRunner } from "../src/api/services/DeployRunner.ts";
import { gzip, tar } from "./fixtures/artifactTarball.ts";

/**
 * The runner, driven end to end with only Cloudflare faked.
 *
 * ⚠️ **The ORDER is what this exists for.** A packed `wrangler.jsonc` carries
 * no `d1_databases`, no `r2_buckets` and no `vars`, deliberately (folio
 * #F1209), so `provision` has to run before the config is regenerated and the
 * ids it obtained are what the build reads. Uploading the packed config instead
 * is the implementation that looks right and produces a Worker whose
 * `DATABASE_URL` is absent - which `alepha/orm` answers by binding
 * `NodeSqliteProvider` and resolving `":memory:"`, saved from silence only by
 * `await import("node:sqlite")` failing on workerd. Loud, but by one step.
 */
describe("deploying an artifact from inside the Worker", () => {
  let alepha: Alepha;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(LoreApi);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const packed = async (resources: Record<string, boolean> = {}) =>
    await gzip(
      tar({
        // A complete manifest, because `buildManifestSchema` is strict and
        // the adapter parses rather than casts: an artifact from a different
        // tool must be refused by name rather than emit a Worker with no
        // bindings and report success.
        //
        // ⚠️ It declares `production` and nothing else. The runner deploys to
        // `b14-preview` anyway, which is the epic's founding difference:
        // `alepha platform` reads the environment out of this file, Lore reads
        // it out of a ROW.
        "dist/manifest.json": JSON.stringify({
          version: 1,
          runtime: "workerd",
          project: "my-app",
          defaultEnv: "production",
          environments: { production: { adapter: "cloudflare" } },
          crons: [],
          websocketPaths: [],
          env: [],
          resources: {
            hasDatabase: true,
            hasBucket: false,
            hasAnalytics: false,
            hasKV: false,
            hasQueue: false,
            hasCron: false,
            hasWebSocket: false,
            ...resources,
          },
        }),
        "dist/index.js": "export default { fetch: () => new Response('ok') };",
        "migrations/sqlite/0001_init/migration.sql":
          "CREATE TABLE t (id integer);",
      }),
    );

  /**
   * Every Cloudflare call a deploy would make, recorded rather than sent.
   *
   * The adapter builds its two clients per call, so those factories are the
   * seam - which is also what keeps one deploy's credential out of another's.
   */
  const withFakeCloudflare = async (bytes: Uint8Array) => {
    const calls: string[] = [];
    let uploaded: { scriptName?: string; bindings?: any[] } = {};

    const provision = {
      ensureD1: async (name: string) => {
        calls.push(`provision:d1:${name}`);
        return { uuid: "db-uuid", name };
      },
      ensureR2: async (name: string) => {
        calls.push(`provision:r2:${name}`);
      },
      ensureKV: async (title: string) => {
        calls.push(`provision:kv:${title}`);
        return { id: "kv-id", title };
      },
      ensureQueue: async (name: string) => {
        calls.push(`provision:queue:${name}`);
        return { queue_id: "q", queue_name: name };
      },
      resolveD1Id: async () => "db-uuid",
      d1Query: async () => [{ results: [] }],
      d1Import: async (_id: string, sql: string) => {
        calls.push(`migrate:${sql.trim().slice(0, 20)}`);
      },
    };

    const deploy = {
      deploy: async (plan: { scriptName: string; bindings?: any[] }) => {
        calls.push(`deploy:${plan.scriptName}`);
        uploaded = plan;
      },
    };

    const runner = alepha.inject(DeployRunner);
    const container = (
      runner as unknown as { container: () => Alepha }
    ).container.bind(runner);

    Object.assign(runner as unknown as Record<string, unknown>, {
      // The bytes come from `$storage` in production; what is under test here
      // starts at the tarball.
      artifactBytes: async () => bytes,
      container: () => {
        const child = container();
        Object.assign(
          child.inject(WorkerCloudflareAdapter) as unknown as Record<
            string,
            unknown
          >,
          { provisioner: () => provision, deployer: () => deploy },
        );
        return child;
      },
    });

    return { runner, calls, uploaded: () => uploaded };
  };

  const request = (over: Record<string, unknown> = {}) => ({
    artifact: {
      app: "my-app",
      sha256: "a".repeat(64),
      fileId: "file-1",
    },
    env: "b14-preview",
    credential: { apiToken: "estate-token", accountId: "estate-account" },
    ...over,
  });

  it("provisions, then builds, then migrates, then uploads", async ({
    expect,
  }) => {
    const { runner, calls } = await withFakeCloudflare(await packed());

    await runner.run(request() as never);

    expect(calls).toEqual([
      "provision:d1:my-app-b14-preview",
      "migrate:CREATE TABLE t (id i",
      "deploy:my-app-b14-preview",
    ]);
  });

  it("uploads bindings the packed config never carried", async ({ expect }) => {
    // ⚠️ The folio #F1209 property, stated as an assertion. The artifact's own
    // `wrangler.jsonc` has no `d1_databases` at all - it is not even in the
    // tarball - so a binding here can only have come from provisioning.
    const { runner, uploaded } = await withFakeCloudflare(await packed());

    await runner.run(request() as never);

    const d1 = uploaded().bindings?.find((it: any) => it.type === "d1");
    expect(d1).toMatchObject({ id: "db-uuid" });
  });

  it("provisions only what the manifest says the app binds", async ({
    expect,
  }) => {
    // An over-broad answer bills somebody for a bucket their app never opens.
    const { runner, calls } = await withFakeCloudflare(
      await packed({ hasDatabase: false, hasBucket: true }),
    );

    await runner.run(request() as never);

    expect(calls.filter((it) => it.startsWith("provision:"))).toEqual([
      "provision:r2:my-app-b14-preview",
    ]);
    // No database means no migration either.
    expect(calls.some((it) => it.startsWith("migrate:"))).toBe(false);
  });

  it("takes the environment from the request, not from the artifact", async ({
    expect,
  }) => {
    // ⚠️ The epic's founding difference. `alepha platform` reads
    // `config.environments[env]` from a file the app committed; Lore has a ROW,
    // so an artifact built before this environment existed deploys to it with
    // no rebuild. The manifest here declares no environments at all.
    const { runner, calls } = await withFakeCloudflare(await packed());

    await runner.run(request({ env: "pr-482" }) as never);

    expect(calls).toContain("deploy:my-app-pr-482");
  });

  it("writes a log a reader can follow, and marks the run", async ({
    expect,
  }) => {
    const { runner } = await withFakeCloudflare(await packed());
    const registry = alepha.inject(DeployRegistry);

    await runner.run(request({ deploymentId: "d-1" }) as never);

    const text = registry.linesOf("d-1").map((it) => it.text);
    expect(registry.statusOf("d-1")).toBe("succeeded");
    expect(text.some((it) => it.startsWith("Fetching"))).toBe(true);
    expect(text.some((it) => it.startsWith("Unpacked"))).toBe(true);
    expect(text.some((it) => it.includes("deploy worker"))).toBe(true);
  });

  it("marks a failed run and says why", async ({ expect }) => {
    const { runner } = await withFakeCloudflare(
      await gzip(tar({ "dist/index.js": "1" })),
    );
    const registry = alepha.inject(DeployRegistry);

    await expect(
      runner.run(request({ deploymentId: "d-2" }) as never),
    ).rejects.toThrow();

    expect(registry.statusOf("d-2")).toBe("failed");
    expect(
      registry.linesOf("d-2").some((it) => it.text.startsWith("Failed:")),
    ).toBe(true);
  });
});
