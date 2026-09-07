import { $inject, Alepha, AlephaError } from "alepha";
import { BuildCloudflareTask, type BuildManifest } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { CloudflareDeployClient } from "../services/CloudflareDeployClient.ts";
import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";
import { D1MigrationsService } from "../services/D1MigrationsService.ts";
import {
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * The credential one deploy runs under.
 *
 * ⚠️ **Per deploy, not per process.** Every field comes from the estate row,
 * opened at the moment of use. There is deliberately no way to fill this from
 * the environment: `CLOUDFLARE_ACCOUNT_ID` inside Lore's Worker is Lore's OWN
 * account, so an environment fallback would deploy a user's artifact, and
 * create their database, in the operator's account.
 */
export interface WorkerCloudflareCredential {
  apiToken: string;
  accountId: string;
  jurisdiction?: "eu" | "fedramp";
}

/**
 * A `PlatformAdapter` a Cloudflare Worker can bundle.
 *
 * ## ⚠️ Why `CloudflareAdapter` could not be this
 *
 * It shells out. `WranglerApi` for the token and the deploy, `node:crypto` for
 * the secret hash, `node:fs/promises` for the manifest. All of that is correct
 * on a laptop and none of it can be bundled for workerd, which is why the
 * `workerd` entry of `alepha/cli/platform-lib` registered no adapter at all
 * until this one.
 *
 * Composed rather than inherited, and from three pieces that already exist:
 * `CloudflareProvisionClient` makes the resources, `CloudflareDeployClient`
 * uploads the Worker, `D1MigrationsService` runs the migrations. This class is
 * the order they go in.
 *
 * ## ⚠️ The order is folio #F1209, and it is the whole of `provision`
 *
 * A packed `wrangler.jsonc` carries **no** `d1_databases`, no `r2_buckets` and
 * no `vars`, deliberately: a build must not freeze a production database id
 * into stored bytes. So provisioning runs FIRST and the ids it obtains are what
 * `build` regenerates the config from. Skipping that and uploading the packed
 * config produces a Worker whose `DATABASE_URL` is absent - `alepha/orm` then
 * binds `NodeSqliteProvider`, `isServerless()` answers `":memory:"` before the
 * "DATABASE_URL is required" throw, and the only thing that saves it is
 * `await import("node:sqlite")` failing on workerd. Loud, but by one step.
 *
 * The ids travel on `BuildTaskContext.env` rather than through `process.env`,
 * which is #288's other half: two deploys share an isolate, and a global that
 * is saved and restored around a call is a race the second deploy wins.
 */
export class WorkerCloudflareAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly buildTask = $inject(BuildCloudflareTask);
  protected readonly migrations = $inject(D1MigrationsService);

  /**
   * The credential for the deploy currently running.
   *
   * ⚠️ Set by the runner immediately before `up()` and never read from
   * anywhere else. It is instance state on a service, which is only safe
   * because a deploy owns its adapter instance: the runner injects a
   * transient, it does not share one between overlapping deploys.
   */
  protected credential?: WorkerCloudflareCredential;

  /**
   * What `provision` obtained, for `build` to regenerate the config from.
   */
  protected provisioned: Record<string, string> = {};

  public use(credential: WorkerCloudflareCredential): this {
    this.credential = credential;
    this.provisioned = {};
    return this;
  }

  protected get estate(): WorkerCloudflareCredential {
    if (!this.credential) {
      throw new AlephaError(
        "This adapter has no Cloudflare credential. The runner has to call `use()` with the estate's token and account id before driving a deploy; nothing here falls back to the environment.",
      );
    }
    return this.credential;
  }

  protected provisioner(): CloudflareProvisionClient {
    return new CloudflareProvisionClient(this.estate);
  }

  protected deployer(): CloudflareDeployClient {
    return new CloudflareDeployClient(this.estate);
  }

  /**
   * Nothing to do, and that is the point.
   *
   * On a laptop this is `wrangler whoami`, a round trip that proves a cached
   * login is still good. Here the credential arrived with the deploy request,
   * so the only thing to check is that one was supplied - and the first real
   * call answers 401 if it is wrong, which is a better error than a probe's.
   */
  async authenticate(): Promise<void> {
    void this.estate;
  }

  /**
   * Create what the app binds, and remember the ids.
   */
  override async provision(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    const api = this.provisioner();

    if (ctx.resources.hasDatabase) {
      const name = ctx.naming.d1();
      await run({
        name: `provision d1 (${name})`,
        handler: async () => {
          const database = await api.ensureD1(name);
          // The shape `BuildCloudflareTask.enhanceD1` parses. It is a URL
          // rather than two variables because that is what the task reads and
          // what a node deploy sets.
          this.provisioned.DATABASE_URL = `d1://${name}:${database.uuid}`;
        },
      });
    }

    if (ctx.resources.hasBucket) {
      const name = ctx.naming.r2();
      await run({
        name: `provision r2 (${name})`,
        handler: async () => {
          await api.ensureR2(name);
          this.provisioned.R2_BUCKET_NAME = name;
        },
      });
    }

    if (ctx.resources.hasKV) {
      const name = ctx.naming.kv();
      await run({
        name: `provision kv (${name})`,
        handler: async () => {
          const namespace = await api.ensureKV(name);
          this.provisioned.CLOUDFLARE_KV_NAME = name;
          this.provisioned.CLOUDFLARE_KV_ID = namespace.id;
        },
      });
    }

    if (ctx.resources.hasQueue) {
      const name = ctx.naming.queue();
      await run({
        name: `provision queue (${name})`,
        handler: async () => {
          await api.ensureQueue(name);
          // The dead-letter queue is a real queue too, and a consumer that
          // names one Cloudflare does not have is refused at bind time.
          await api.ensureQueue(`${name}-dlq`);
          this.provisioned.CLOUDFLARE_QUEUE_NAME = name;
        },
      });
    }

    if (ctx.resources.hasAnalytics) {
      // Analytics Engine datasets are created on first write, so there is
      // nothing to provision - only a name to pass to the build.
      this.provisioned.CLOUDFLARE_ANALYTICS_DATASET = ctx.naming.analytics();
    }

    if (this.jurisdictionOf()) {
      this.provisioned.CLOUDFLARE_JURISDICTION =
        this.jurisdictionOf() as string;
    }
    if (ctx.envConfig.domain) {
      this.provisioned.CLOUDFLARE_DOMAIN = ctx.envConfig.domain;
    }
  }

  protected jurisdictionOf(): string | undefined {
    return this.credential?.jurisdiction;
  }

  /**
   * Regenerate `wrangler.jsonc` and the Worker entry point against the ids
   * `provision` just obtained.
   *
   * Always prebuilt: Lore's Worker cannot run Vite, so the client always builds
   * elsewhere and this step only ever emits config.
   */
  async build(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const manifestPath = this.fs.join(ctx.root, "dist", "manifest.json");
    let manifest: BuildManifest;
    try {
      manifest = JSON.parse(await this.fs.readTextFile(manifestPath));
    } catch (error) {
      throw new AlephaError(
        `Cannot read ${manifestPath}: ${(error as Error).message}. A deploy needs the manifest the artifact was packed with.`,
      );
    }

    await this.buildTask.run({
      // Never dereferenced in prebuilt mode: the task reads resources, crons
      // and containers from the manifest.
      alepha: null as unknown as Alepha,
      options: {
        target: "cloudflare",
        output: { dist: "dist", public: "public" },
      },
      run,
      root: ctx.root,
      entry: { root: ctx.root, server: "" },
      hasClient: false,
      manifest,
      platformOptions: null,
      flags: { prebuilt: true },
      // ⚠️ The ids from `provision`, and ONLY those. `ctx.env` present means it
      // is the whole environment, so this build cannot inherit Lore's own
      // `DATABASE_URL` for a database it never provisioned.
      env: this.provisioned,
    } as never);
  }

  override async migrate(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    if (!ctx.resources.hasDatabase) {
      return;
    }
    const name = ctx.naming.d1();
    await run({
      name: `migrate d1 (${name})`,
      handler: async () => {
        await this.migrations.apply(
          this.provisioner(),
          name,
          ctx.root,
          "migrations/sqlite",
        );
      },
    });
  }

  /**
   * Upload the Worker.
   *
   * ⚠️ Reads the config `build` just wrote, and the config only. The packed
   * one is scratch; this one carries the bindings.
   */
  async deploy(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    const worker = ctx.naming.worker();
    const distDir = this.fs.join(ctx.root, "dist");
    const config = JSON.parse(
      await this.fs.readTextFile(this.fs.join(distDir, "wrangler.jsonc")),
    ) as WranglerConfig;

    await run({
      name: `deploy worker (${worker})`,
      handler: async () => {
        await this.deployer().deploy({
          scriptName: worker,
          mainModule: config.main ?? "index.js",
          modules: await this.modules(distDir, config),
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          bindings: this.bindings(config),
          migrations: config.migrations?.[0],
          observability: config.observability,
          placement: config.placement,
          limits: config.limits,
          crons: config.triggers?.crons ?? [],
          domain: config.routes?.find((it) => it.custom_domain)
            ? {
                hostname: config.routes.find((it) => it.custom_domain)
                  ?.pattern as string,
              }
            : undefined,
          workersDev: config.workers_dev,
        });
      },
    });

    return ctx.envConfig.domain ? `https://${ctx.envConfig.domain}` : undefined;
  }

  /**
   * The module set, from the config's own `rules` globs.
   *
   * ⚠️ No import-graph walk. With `no_bundle` wrangler globs files under the
   * module root against `rules` and excludes the entry, and the generated
   * config sets `rules: [{ type: "ESModule", globs: ["index.js", "server/*.js"] }]`,
   * so the upload set is a directory listing.
   */
  protected async modules(
    distDir: string,
    config: WranglerConfig,
  ): Promise<Array<{ name: string; bytes: Uint8Array }>> {
    const modules: Array<{ name: string; bytes: Uint8Array }> = [];
    const entries = await this.fs.ls(distDir, { recursive: true });
    for (const entry of entries) {
      if (!entry.endsWith(".js") && !entry.endsWith(".mjs")) continue;
      // `public/` is served as assets, not uploaded as modules.
      if (entry.startsWith("public/")) continue;
      modules.push({
        name: entry,
        bytes: new Uint8Array(await this.fs.readFile(`${distDir}/${entry}`)),
      });
    }
    if (modules.length === 0) {
      throw new AlephaError(
        `No modules to upload under ${distDir}. The artifact carries no built server.`,
      );
    }
    return modules;
  }

  /**
   * The generated config's bindings, as the API's own binding objects.
   */
  protected bindings(config: WranglerConfig): Array<Record<string, unknown>> {
    const bindings: Array<Record<string, unknown>> = [];
    for (const database of config.d1_databases ?? []) {
      bindings.push({
        type: "d1",
        name: database.binding,
        id: database.database_id,
      });
    }
    for (const bucket of config.r2_buckets ?? []) {
      bindings.push({
        type: "r2_bucket",
        name: bucket.binding,
        bucket_name: bucket.bucket_name,
      });
    }
    for (const namespace of config.kv_namespaces ?? []) {
      bindings.push({
        type: "kv_namespace",
        name: namespace.binding,
        namespace_id: namespace.id,
      });
    }
    for (const queue of config.queues?.producers ?? []) {
      bindings.push({
        type: "queue",
        name: queue.binding,
        queue_name: queue.queue,
      });
    }
    for (const dataset of config.analytics_engine_datasets ?? []) {
      bindings.push({
        type: "analytics_engine",
        name: dataset.binding,
        dataset: dataset.dataset,
      });
    }
    for (const [name, text] of Object.entries(config.vars ?? {})) {
      bindings.push({ type: "plain_text", name, text: String(text) });
    }
    return bindings;
  }

  /**
   * ⚠️ Refused rather than implemented. `inspect` and `teardown` answer `plan`,
   * `status` and `down`, which are `alepha platform`'s commands and run on a
   * laptop with the full adapter. A Worker deploy has no surface for them, and
   * a half-answer here would make `plan` report an empty environment as an
   * empty one.
   */
  async inspect(): Promise<PlatformState> {
    throw new AlephaError(
      "The worker-side Cloudflare adapter does not inspect. Run `alepha platform status` locally, where the full adapter is.",
    );
  }

  async teardown(): Promise<void> {
    throw new AlephaError(
      "The worker-side Cloudflare adapter does not tear down. Run `alepha platform down` locally, where the full adapter is.",
    );
  }
}

/**
 * The slice of a generated `wrangler.jsonc` a deploy reads back.
 *
 * Loosely typed on purpose: the file is written by `BuildCloudflareTask`, which
 * owns its shape, and pinning a second definition here is how the two come to
 * disagree about a field one of them emits.
 */
interface WranglerConfig {
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  workers_dev?: boolean;
  vars?: Record<string, unknown>;
  triggers?: { crons?: string[] };
  routes?: Array<{ pattern?: string; custom_domain?: boolean }>;
  d1_databases?: Array<{ binding: string; database_id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  queues?: { producers?: Array<{ binding: string; queue: string }> };
  analytics_engine_datasets?: Array<{ binding: string; dataset: string }>;
  migrations?: Array<Record<string, unknown>>;
  observability?: Record<string, unknown>;
  placement?: Record<string, unknown>;
  limits?: Record<string, unknown>;
}
