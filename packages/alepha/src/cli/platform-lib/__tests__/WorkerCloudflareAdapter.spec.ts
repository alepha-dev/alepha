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
    // Complete, because the adapter PARSES rather than casts: a manifest that
    // is truncated or from a different tool has to be refused by name rather
    // than emit a Worker with no bindings and report success.
    await fs.writeFile(
      "/deploy/dist/manifest.json",
      JSON.stringify({
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
          hasBucket: true,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
          hasWebSocket: false,
        },
      }),
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
    // ⚠️ It tears down only what a deploy RECORDED, through `teardownRecorded`.
    // The adapter interface's own `teardown` derives every name from the
    // context, and on a lent estate that is the delete this class refuses.
    await expect(adapter.teardown()).rejects.toThrowError(
      /only what a deploy recorded/,
    );
  });
  /**
   * ⚠️ The entry is the ONE name that has to agree across two spellings.
   *
   * `BuildCloudflareTask` writes `main: "./main.cloudflare.js"`, and
   * `modules()` names every uploaded part from a directory listing, so the
   * parts carry no `./`. Cloudflare does not validate the mismatch: it
   * answers `Uncaught SyntaxError: Invalid or unexpected token at
   * worker.js:1:2`, naming a file nobody wrote. This test uses the config the
   * build really writes rather than a pre-normalised one, which is why the
   * bug survived a green `CloudflareDeployClient` spec.
   */
  const deployable = async (fs: MemoryFileSystemProvider, main: string) => {
    await fs.writeFile(
      "/deploy/dist/wrangler.jsonc",
      JSON.stringify({
        name: "my-app",
        main,
        compatibility_date: "2025-11-17",
        rules: [{ type: "ESModule", globs: ["index.js"] }],
      }),
    );
    await fs.writeFile("/deploy/dist/main.cloudflare.js", "export default {};");
    await fs.writeFile("/deploy/dist/index.js", "export const a = 1;");
  };

  const recordingDeployer = (adapter: WorkerCloudflareAdapter) => {
    const calls: Array<Record<string, any>> = [];
    Object.assign(adapter as unknown as Record<string, unknown>, {
      deployer: () => ({
        deploy: async (plan: Record<string, any>) => {
          calls.push(plan);
          return { versionId: "v1" };
        },
      }),
    });
    return calls;
  };

  it("uploads the entry under the name the modules actually carry", async ({
    expect,
  }) => {
    const { adapter, fs, naming } = setup();
    adapter.use(credential);
    await deployable(fs, "./main.cloudflare.js");
    const calls = recordingDeployer(adapter);

    await adapter.deploy(context(naming), run);

    const plan = calls[0]!;
    expect(plan.mainModule).toBe("main.cloudflare.js");
    // The invariant, rather than the string: the entry must name an uploaded
    // part, whatever either side spells it.
    expect(plan.modules.map((it: { name: string }) => it.name)).toContain(
      plan.mainModule,
    );
  });

  it("refuses locally when the entry names no uploaded module", async ({
    expect,
  }) => {
    const { adapter, fs, naming } = setup();
    adapter.use(credential);
    await deployable(fs, "./nope.js");
    recordingDeployer(adapter);

    await expect(adapter.deploy(context(naming), run)).rejects.toThrowError(
      /names `nope.js` as its entry/,
    );
  });
  describe("what the copy's address implies", () => {
    /**
     * ⚠️ `CloudflareAdapter` has derived `PUBLIC_URL` from the configured
     * domain all along, and this adapter did not. Notification emails, OAuth
     * callbacks and the sitemap all read it, so the same app deployed from a
     * laptop and through Lore resolved absolute links differently, and neither
     * side said so.
     */
    it("derives PUBLIC_URL from the domain the copy deploys to", async ({
      expect,
    }) => {
      const { adapter, fs, naming } = setup();
      adapter.use(credential).withSecrets({ OTHER: "kept" });
      await deployable(fs, "./main.cloudflare.js");
      const calls = recordingDeployer(adapter);

      const ctx = context(naming);
      ctx.envConfig.domain = "app.example.com";
      await adapter.deploy(ctx, run);

      expect(calls[0]!.secrets).toEqual({
        OTHER: "kept",
        PUBLIC_URL: "https://app.example.com",
      });
    });

    it("keeps an explicit PUBLIC_URL, for a copy behind a proxy", async ({
      expect,
    }) => {
      const { adapter, fs, naming } = setup();
      adapter
        .use(credential)
        .withSecrets({ PUBLIC_URL: "https://vanity.example" });
      await deployable(fs, "./main.cloudflare.js");
      const calls = recordingDeployer(adapter);

      const ctx = context(naming);
      ctx.envConfig.domain = "app.example.com";
      await adapter.deploy(ctx, run);

      expect(calls[0]!.secrets.PUBLIC_URL).toBe("https://vanity.example");
    });

    it("adds nothing when the copy has no domain", async ({ expect }) => {
      const { adapter, fs, naming } = setup();
      adapter.use(credential).withSecrets({ OTHER: "kept" });
      await deployable(fs, "./main.cloudflare.js");
      const calls = recordingDeployer(adapter);

      await adapter.deploy(context(naming), run);

      expect(calls[0]!.secrets).toEqual({ OTHER: "kept" });
    });
  });
});
