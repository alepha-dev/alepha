import { Alepha } from "alepha";
import { WorkerCloudflareAdapter } from "alepha/cli/platform-lib";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreApi } from "../src/api/index.ts";
import { DeployRunner } from "../src/api/services/DeployRunner.ts";
import { gzip, type TarEntry, tar } from "./fixtures/artifactTarball.ts";

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
 *
 * ⚠️ **A replay is not checked here, and cannot be.** A retried or replayed
 * job execution runs the whole deploy again, so every step has to be safe to
 * repeat - but the fakes below replace the provisioning client and the
 * deployer whole, so no find-before-create, asset dedup or `d1_migrations`
 * guard ever runs under them. A replay driven through these fakes never
 * exercises what makes a replay safe. It is checked in two places instead:
 *
 * - `packages/alepha/src/cli/platform-lib/__tests__/deployIdempotence.spec.ts`
 *   runs one Worker deploy twice through the real clients, against a fake
 *   account behind `fetch` that refuses a duplicate the way Cloudflare does.
 * - `deployments.spec.ts`, beside this file, holds the half that is Lore's
 *   own: "does not re-run a deploy that already finished".
 *
 * One path neither covers: this runner hands its assets to the adapter through
 * `useAssets`, streamed out of the tarball, while the platform-lib spec lets
 * the adapter read them off a filesystem. Nothing checks that a replayed Lore
 * deploy uploads no asset a second time.
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

  const packed = async (
    resources: Record<string, boolean> = {},
    extra: Record<string, string | TarEntry> = {},
  ) =>
    await gzip(
      tar({
        // A complete manifest, because `buildManifestSchema` is strict and
        // the adapter parses rather than casts: an artifact from a different
        // tool must be refused by name rather than emit a Worker with no
        // bindings and report success.
        //
        // ⚠️ It names no environment at all: Lore reads the environment out
        // of a ROW, never out of the artifact.
        "manifest.json": JSON.stringify({
          project: "my-app",
          runtimes: [
            { runtime: "node", entry: "index.node.js" },
            { runtime: "workerd", entry: "index.workerd.js" },
          ],
          crons: [],
          secrets: [],
          variables: [],
          cloudflare: { websocketPaths: [] },
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
        // ⚠️ The WORKERD slice. A Cloudflare deploy uploads the slice the
        // generated `wrangler.jsonc` globs name, and a node slice is
        // deliberately not one of them: it is the other half of the same
        // artifact and the Worker cannot run it.
        "index.workerd.js":
          "export default { fetch: () => new Response('ok') };",
        "migrations/sqlite/0001_init/migration.sql":
          "CREATE TABLE t (id integer);",
        ...extra,
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
    let uploaded: {
      scriptName?: string;
      bindings?: any[];
      assets?: {
        manifest: Record<string, unknown>;
        config?: Record<string, unknown>;
      };
    } = {};

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
      deploy: async (plan: typeof uploaded & { scriptName: string }) => {
        calls.push(`deploy:${plan.scriptName}`);
        uploaded = plan;
      },
      // A copy with no domain answers on workers.dev (#Q2132), and the
      // adapter reads the account's subdomain to compose that address.
      getSubdomain: async () => "acme",
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
    // ⚠️ The project is the FIRST segment of every resource name, which is what
    // keeps two Lore projects that both call an app `my-app` off each other's
    // database. `DeployService.prefixOf` composes it; here it is given.
    project: "acme",
    credential: { apiToken: "estate-token", accountId: "estate-account" },
    ...over,
  });

  it("provisions, then builds, then migrates, then uploads", async ({
    expect,
  }) => {
    const { runner, calls } = await withFakeCloudflare(await packed());

    await runner.run(request() as never);

    expect(calls).toEqual([
      "provision:d1:acme-my-app-b14-preview",
      "migrate:CREATE TABLE t (id i",
      "deploy:acme-my-app-b14-preview",
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
      "provision:r2:acme-my-app-b14-preview",
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

    expect(calls).toContain("deploy:acme-my-app-pr-482");
  });

  /**
   * ⚠️ **The archive path, which is the one `apps/docs` deploys through.** Its
   * `_headers` was listed in the asset manifest like any file, so Cloudflare
   * served `https://alepha.dev/_headers` as a page and applied none of it. The
   * adapter spec covers a deploy off a disk; this is the runner's own first
   * pass, which never writes `dist/public` to a filesystem at all.
   */
  it("sends _headers and _redirects as asset config, and uploads none of the three config files", async ({
    expect,
  }) => {
    const headers = "/*\n  X-Content-Type-Options: nosniff\n";
    const redirects = "/old /new 301\n";
    const { runner, uploaded } = await withFakeCloudflare(
      await packed(
        {},
        {
          // A directory entry, as `alepha pack` writes one: it is what makes
          // the build see a `public/` and emit an `assets` block at all.
          "public/": { typeflag: "5" },
          "public/index.html": "<!doctype html>",
          "public/_headers": headers,
          "public/_redirects": redirects,
          "public/.assetsignore": "*.map\n",
        },
      ),
    );

    await runner.run(request() as never);

    const assets = uploaded().assets!;
    // The manifest is the whole upload: Cloudflare asks for files by the
    // hashes it names, and the second pass streams only what it is asked for.
    expect(Object.keys(assets.manifest)).toEqual(["/index.html"]);
    expect(assets.config).toMatchObject({
      _headers: headers,
      _redirects: redirects,
    });
  });

  it("runs with no deployment row at all", async ({ expect }) => {
    // A deploy driven from a test, or from the CLI against an instance whose
    // row does not exist yet, has nothing to write against and must still run.
    const { runner, calls } = await withFakeCloudflare(await packed());

    await runner.run(request() as never);

    expect(calls).toContain("deploy:acme-my-app-b14-preview");
  });
});
