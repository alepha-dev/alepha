import { $inject, Alepha, AlephaError } from "alepha";
import {
  BuildCloudflareTask,
  type BuildManifest,
  buildManifestSchema,
} from "alepha/cli";
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
    this.provisionedResources = {};
    return this;
  }

  /**
   * What the deployed Worker reads as its environment.
   *
   * ⚠️ **Uploaded WITH the script**, as `secret_text` bindings in the same
   * `PUT`, which is why {@link PlatformAdapter.secrets} stays the inherited
   * no-op here. `PlatformOrchestrator.up()` runs `deploy` then `secrets` only
   * because `wrangler secret put` needs the worker to exist, and its own
   * comment records what that costs: about six seconds of the new build
   * running against the previous secret set, and a deploy introducing a newly
   * required variable booting without it. Nothing here shells out to wrangler,
   * so there is no such ordering and no such window.
   *
   * ⚠️ Never logged, never put in a progress line, never returned. The values
   * exist on this instance for the length of one deploy.
   */
  public withSecrets(secrets: Record<string, string>): this {
    this.appSecrets = secrets;
    return this;
  }

  /**
   * The set {@link withSecrets} was given, empty until it is called.
   */
  protected appSecrets: Record<string, string> = {};

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
          this.provisionedResources.d1 = { name, id: database.uuid };
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
          this.provisionedResources.r2 = name;
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
          this.provisionedResources.kv = { name, id: namespace.id };
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
          this.provisionedResources.queue = name;
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
    let raw: unknown;
    try {
      raw = JSON.parse(await this.fs.readTextFile(manifestPath));
    } catch (error) {
      throw new AlephaError(
        `Cannot read ${manifestPath}: ${(error as Error).message}. A deploy needs the manifest the artifact was packed with.`,
      );
    }

    // ⚠️ **Parsed, not cast.** Everything below builds a Worker out of this
    // object with no live Alepha to check it against, so a manifest that is
    // truncated or from a different tool emits a Worker with no bindings and
    // still reports success. Parsing also applies the schema's defaults, which
    // is what stops an absent `crons` from being a crash rather than an empty
    // list.
    //
    // Refused rather than fallen back on: unlike a local deploy there is no
    // introspection to fall through to, because the app cannot be booted here.
    const validated = buildManifestSchema.safeParse(raw);
    if (!validated.success) {
      throw new AlephaError(
        `${manifestPath} is not a valid build manifest: ${validated.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`,
          )
          .join(
            "; ",
          )}. Rebuild the artifact with \`alepha build -t cloudflare\`.`,
      );
    }
    const manifest = validated.data as BuildManifest;

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
  /**
   * The version the last upload produced, for the runner to record.
   *
   * ⚠️ On the instance rather than in the return value, because
   * `PlatformAdapter.deploy` answers a URL and widening that signature would
   * touch every adapter for one caller's benefit.
   */
  public deployedVersionId?: string;

  /**
   * What this deploy actually provisioned, by id where one exists.
   *
   * ## ⚠️ Recorded so a teardown can delete what Lore MADE
   *
   * The names are derived from `(project, env)` and are therefore
   * reproducible, which makes "recompute the name and delete it" the obvious
   * implementation and the wrong one: on a lent estate that deletes whatever
   * currently bears the name, including a database somebody created before
   * Lore ever saw the account. `alepha platform down` may do that - it runs on
   * your own machine against your own account, at your own typing - but Lore
   * holds a credential lent for deploys, and must only ever remove what it can
   * show it created.
   *
   * A D1 database carries its uuid, which survives a rename and is what makes
   * the delete unambiguous. The rest are names, because Cloudflare identifies
   * them by name.
   */
  public provisionedResources: {
    worker?: string;
    d1?: { name: string; id: string };
    r2?: string;
    kv?: { name: string; id: string };
    queue?: string;
  } = {};

  async deploy(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    const worker = ctx.naming.worker();
    const distDir = this.fs.join(ctx.root, "dist");
    const config = JSON.parse(
      await this.fs.readTextFile(this.fs.join(distDir, "wrangler.jsonc")),
    ) as WranglerConfig;

    // Recorded before the upload rather than after: a Worker that half-uploads
    // still exists at Cloudflare, and a teardown that cannot name it is how an
    // orphan becomes permanent.
    this.provisionedResources.worker = worker;

    await run({
      name: `deploy worker (${worker})`,
      handler: async () => {
        const modules = await this.modules(distDir, config);
        const mainModule = this.moduleName(config.main ?? "index.js");

        // ⚠️ A `main_module` naming no uploaded part is not a validation
        // error at Cloudflare. It answers `Uncaught SyntaxError: Invalid or
        // unexpected token at worker.js:1:2`, which names a file nobody
        // wrote and says nothing about the real mistake. Refusing here keeps
        // the failure legible and local.
        if (!modules.some((it) => it.name === mainModule)) {
          throw new AlephaError(
            `The deploy config names \`${mainModule}\` as its entry, but the upload carries ${modules
              .map((it) => `\`${it.name}\``)
              .join(", ")}. The entry must be one of the modules.`,
          );
        }

        const answer = await this.deployer().deploy({
          scriptName: worker,
          mainModule,
          modules,
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          bindings: this.bindings(config),
          // ⚠️ Sent in the same upload as the code, which is what removes the
          // window `PlatformOrchestrator.up()`'s two-step ordering leaves open.
          // `putScript` turns each entry into a `secret_text` binding beside
          // the resource bindings above.
          secrets: this.secretsFor(ctx),
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
        this.deployedVersionId = answer?.versionId;
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
  /**
   * The app's own variables, plus the one the copy's address implies.
   *
   * ⚠️ **Parity with `CloudflareAdapter`, which has derived `PUBLIC_URL` from
   * the configured domain all along.** Without it, absolute links resolve to
   * nothing at runtime - notification emails, OAuth callbacks and the sitemap
   * all read it - so the same app deployed from a laptop and through Lore
   * behaved differently in a way neither side announced.
   *
   * An explicit value always wins. On this path it is a variable the operator
   * set on the copy, and a copy deployed behind a proxy or under a vanity host
   * has to be able to say so.
   */
  protected secretsFor(ctx: PlatformContext): Record<string, string> {
    const domain = ctx.envConfig.domain;
    if (!domain || this.appSecrets.PUBLIC_URL) {
      return this.appSecrets;
    }
    return { ...this.appSecrets, PUBLIC_URL: `https://${domain}` };
  }

  /**
   * The name a module is uploaded under, from a path a config wrote relative.
   *
   * ⚠️ A generated `wrangler.jsonc` writes `main: "./main.cloudflare.js"`,
   * and {@link modules} names every part from a directory listing, so the
   * parts carry no `./`. The two spellings have to be reconciled somewhere,
   * and it is here rather than in the build, because the upload set is what
   * defines the namespace the entry has to live in.
   */
  protected moduleName(path: string): string {
    return path.replace(/^\.?\//, "");
  }

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
