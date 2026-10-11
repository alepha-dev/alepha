import {
  $inject,
  $store,
  AlephaError,
  type Alepha as AlephaInstance,
} from "alepha";
import {
  type BuildManifest,
  buildManifestSchema,
  BuildCloudflareTask,
  type BuildTaskContext,
} from "alepha/cli";
import { EnvUtils, Runner, type RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { S3mini } from "s3mini";

import { infraOptions } from "../atoms/infraOptions.ts";
import {
  type CloudflareEnvironmentOptions,
  cloudflareEnvironmentOptionsSchema,
} from "../schemas/cloudflareEnvironmentOptions.ts";
import {
  readManifestVariables,
  EXCLUDED_SECRET_KEYS as SHARED_EXCLUDED_SECRET_KEYS,
  resolveSecretKeySet,
  selectSecrets,
} from "../secretKeys.ts";
import { CloudflareCredentialSource } from "../services/CloudflareCredentialSource.ts";
import { CloudflareDeployClient } from "../services/CloudflareDeployClient.ts";
import { CloudflareProvisionClient } from "../services/CloudflareProvisionClient.ts";
import {
  type D1MigrationTransport,
  D1MigrationsService,
} from "../services/D1MigrationsService.ts";
import { NamingService } from "../services/NamingService.ts";
import { StoragePlaceholderService } from "../services/StoragePlaceholderService.ts";
import { WranglerApi } from "../services/WranglerApi.ts";
import {
  type ExportDbOptions,
  InfraAdapter,
  type InfraContext,
  type InfraLoginOptions,
  type InfraState,
} from "./InfraAdapter.ts";
import {
  type WorkerCloudflareCredential,
  WorkerCloudflareAdapter,
} from "./WorkerCloudflareAdapter.ts";

/**
 * Cloudflare Workers adapter.
 *
 * Provisions, inspects and tears down through `CloudflareProvisionClient`
 * and uploads through `WorkerCloudflareAdapter`: the clients Lore deploys
 * with, so there is one Cloudflare path (#E75). The deploy carries the secrets,
 * see `deploy`. The credential comes from `CloudflareCredentialSource`:
 * `CLOUDFLARE_API_TOKEN` first, wrangler only for an interactive login.
 */
export class CloudflareAdapter extends InfraAdapter<CloudflareEnvironmentOptions> {
  static readonly id = "cloudflare";
  static readonly options = cloudflareEnvironmentOptionsSchema;

  override readonly serverless = true;
  override readonly cloudflareResources = true;

  protected readonly log = $logger();
  protected readonly naming = $inject(NamingService);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly wrangler = $inject(WranglerApi);
  protected readonly credentials = $inject(CloudflareCredentialSource);
  /**
   * The upload, which is Lore's code (#Q2612).
   *
   * ⚠️ **Transient, and that is what keeps the container acyclic.** The
   * Worker adapter injects `D1MigrationsService`, whose module is this one's:
   * a container that injects `WorkerCloudflareAdapter` FIRST (Lore's
   * `DeployRunner` does) registers that module while the Worker adapter is
   * still being built, which builds this adapter, which asked for the
   * singleton being built. A transient is a fresh instance, so there is no
   * cycle to find; it is also what the Worker adapter asks of its runners,
   * one instance per deploy.
   */
  protected readonly workerAdapter = $inject(WorkerCloudflareAdapter, {
    lifetime: "transient",
  });
  protected readonly d1Migrations = $inject(D1MigrationsService);
  protected readonly runner = $inject(Runner);
  protected readonly buildTask = $inject(BuildCloudflareTask);
  protected readonly placeholders = $inject(StoragePlaceholderService);
  protected readonly options = $store(infraOptions);

  protected provisionedD1Id?: string;
  protected provisionedHyperdriveId?: string;
  protected provisionedKVIds = new Map<string, string>();

  /**
   * Check if the user's DATABASE_URL points to an external Postgres database.
   * If so, we use Hyperdrive instead of D1.
   *
   * Reads from `.env.{env}` first, falls back to `process.env`.
   */
  protected async isPostgres(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<boolean> {
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);
    const dbUrl = envVars.DATABASE_URL ?? process.env.DATABASE_URL;
    return !!dbUrl?.startsWith("postgres:");
  }

  /**
   * The credential this environment runs under: the run's token, its account
   * and the environment's jurisdiction. See `CloudflareCredentialSource`.
   */
  protected async credentialFor(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<WorkerCloudflareCredential> {
    const { credential } = await this.credentials.resolve({
      root: ctx.root,
      accountId: ctx.options.accountId,
      jurisdiction: ctx.options.jurisdiction,
    });
    return credential;
  }

  /**
   * A provisioning client under this environment's credential.
   */
  protected async provisionerFor(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<CloudflareProvisionClient> {
    return this.provisioner(await this.credentialFor(ctx));
  }

  /**
   * The D1 migration transport for this environment's database, which is
   * the provisioning client (`alepha infra db baseline mark` drives it).
   */
  public async d1Transport(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<D1MigrationTransport> {
    return await this.provisionerFor(ctx);
  }

  protected async runShell(
    command: string,
    options: Parameters<ShellProvider["run"]>[1] = {},
  ) {
    const output = await this.shell.run(command, options);

    // When the caller captured the output, echo it to the log so the user
    // still sees it (uncaptured commands stream straight to the terminal).
    if (options.capture) {
      this.log.info(output);
    }

    return output;
  }

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  /**
   * Hands off to `wrangler login`, which owns Cloudflare credentials.
   *
   * Deliberately not reimplemented: wrangler already stores, refreshes and
   * scopes the token, and Cloudflare opens its device grant to first-party
   * clients only (folio #F1374). `--device` is passed through for SSH
   * sessions and containers with no browser.
   */
  override async login(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
    options: InfraLoginOptions = {},
  ): Promise<void> {
    await run({
      name: options.device ? "wrangler login --device" : "wrangler login",
      handler: async () => {
        await this.wrangler.ensureInstalled(ctx.root);
        await this.wrangler.login({ device: options.device });
        this.credentials.reset();
      },
    });
  }

  override async logout(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    await run({
      name: "wrangler logout",
      handler: async () => {
        await this.wrangler.ensureInstalled(ctx.root);
        await this.shell.run("wrangler logout", { root: ctx.root });
        this.credentials.reset();
      },
    });
  }

  /**
   * Settle the run's credential, token and account both.
   *
   * ⚠️ With `CLOUDFLARE_API_TOKEN` set, wrangler is neither called nor
   * installed. Without it, wrangler's stored login is read once; and only on
   * a TTY does a missing one start `wrangler login`. See
   * `CloudflareCredentialSource`.
   */
  async authenticate(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    await run({
      name: "authenticate",
      handler: async () => {
        await this.credentials.resolve({
          root: ctx.root,
          accountId: ctx.options.accountId,
          jurisdiction: ctx.options.jurisdiction,
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // build
  // -------------------------------------------------------------------------

  /**
   * Fill in resource ids that `provision()` would have set, by looking up what
   * already exists on the account.
   *
   * `provision()` and `build()` share process state, so a full `platform
   * deploy` had the ids in hand. The granular commands (`platform build`,
   * `platform deploy`) never call provision, so those fields were empty and the
   * generated `wrangler.jsonc` silently came out with no D1 binding  -  or a KV
   * binding with an empty id  -  and the deploy shipped a worker with no
   * database. Nothing failed; the worker just 500'd on first query.
   *
   * Lookup only: this never creates anything (that is `provision`'s job). A
   * resource the app needs but the account does not have is a hard error, not
   * a silently missing binding.
   */
  protected async resolveExistingResourceIds(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<void> {
    const needsDatabase =
      ctx.resources.hasDatabase &&
      !this.provisionedD1Id &&
      !this.provisionedHyperdriveId;
    const needsKV =
      ctx.resources.hasKV && !this.provisionedKVIds.has(ctx.naming.kv());
    if (!needsDatabase && !needsKV) {
      // Nothing to look up, so no credential: `alepha infra build` of an app
      // with no resources stays offline.
      return;
    }
    const api = await this.provisionerFor(ctx);

    if (ctx.resources.hasDatabase && !this.provisionedD1Id) {
      if (this.provisionedHyperdriveId) {
        // Hyperdrive already resolved  -  nothing to look up.
      } else if (await this.isPostgres(ctx)) {
        const name = ctx.naming.hyperdrive();
        const found = (await api.listHyperdrive()).find(
          (it) => it.name === name,
        );
        if (!found) {
          throw new AlephaError(
            `Hyperdrive config '${name}' does not exist. Run 'alepha deploy' before building.`,
          );
        }
        this.provisionedHyperdriveId = found.id;
      } else {
        const name = ctx.naming.d1();
        const found = (await api.listD1()).find((it) => it.name === name);
        if (!found) {
          throw new AlephaError(
            `D1 database '${name}' does not exist. Run 'alepha deploy' before building.`,
          );
        }
        this.provisionedD1Id = found.uuid;
      }
    }

    if (ctx.resources.hasKV) {
      const name = ctx.naming.kv();
      if (!this.provisionedKVIds.has(name)) {
        const found = (await api.listKV()).find((it) => it.title === name);
        if (!found) {
          throw new AlephaError(
            `KV namespace '${name}' does not exist. Run 'alepha deploy' before building.`,
          );
        }
        this.provisionedKVIds.set(name, found.id);
      }
    }
  }

  async build(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    await this.resolveExistingResourceIds(ctx);
    const appDir = ctx.root;

    const env: Record<string, string> = {};

    // An app can declare object storage either with `$storage` or by
    // setting R2_BUCKET_NAME itself (the "blobs without a database" route,
    // where nothing observable at build time reveals the need  -  see
    // BuildCloudflareTask.writeManifest). Forward an explicit value into
    // the build so resource detection can see it.
    const declaredBucket = (
      await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`])
    ).R2_BUCKET_NAME;
    if (declaredBucket) {
      env.R2_BUCKET_NAME = declaredBucket;
    }

    // Same forwarding, same reason, for the analytics escape hatch
    // (`BuildManifestTask`'s `CLOUDFLARE_ANALYTICS_DATASET` check). Without
    // this, a value set only in `.env.<env>` on disk would never reach the
    // spawned `alepha build` below, whose own resource detection reads
    // `process.env`  -  not this file.
    const declaredDataset = (
      await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`])
    ).CLOUDFLARE_ANALYTICS_DATASET;
    if (declaredDataset) {
      env.CLOUDFLARE_ANALYTICS_DATASET = declaredDataset;
    }

    if (ctx.resources.hasDatabase) {
      if (this.provisionedHyperdriveId) {
        env.HYPERDRIVE_ID = this.provisionedHyperdriveId;
        const envVars = await this.envUtils.parseEnv(ctx.root, [
          `.env.${ctx.env}`,
        ]);
        const pgSchema = envVars.POSTGRES_SCHEMA ?? process.env.POSTGRES_SCHEMA;
        if (pgSchema) {
          env.POSTGRES_SCHEMA = pgSchema;
        }
      } else if (this.provisionedD1Id) {
        const dbName = ctx.naming.d1();
        env.DATABASE_URL = `d1://${dbName}:${this.provisionedD1Id}`;
      }
    }

    if (ctx.resources.hasBucket) {
      // An explicit name wins: it may point at a pre-existing bucket whose
      // objects are already keyed under it, and renaming would orphan them.
      env.R2_BUCKET_NAME ??= ctx.naming.r2();
    }

    if (ctx.resources.hasAnalytics) {
      // An explicit name wins, same reasoning as R2 above (and already
      // forwarded above if it came from `.env.<env>`). Unlike every other
      // resource here, there is no `ensureAnalytics()` step and never will
      // be: Cloudflare has no API to create an Analytics Engine dataset
      // ahead of time. It materializes on the first `writeDataPoint()`,
      // with no id to pair with a name the way D1 and KV need one  -  so
      // "provisioning" it is exactly this line, computing the name and
      // setting the env var, with nothing left to call.
      env.CLOUDFLARE_ANALYTICS_DATASET ??= ctx.naming.analytics();
    }

    if (ctx.resources.hasKV) {
      const kvName = ctx.naming.kv();
      env.CLOUDFLARE_KV_NAME = kvName;
      const kvId = this.provisionedKVIds.get(kvName);
      if (kvId) {
        env.CLOUDFLARE_KV_ID = kvId;
      }
    }

    if (ctx.resources.hasQueue) {
      env.CLOUDFLARE_QUEUE_NAME = ctx.naming.queue();
    }

    const host = ctx.options.domain;
    if (host) {
      env.CLOUDFLARE_DOMAIN = host;
    }

    if (ctx.options.jurisdiction) {
      env.CLOUDFLARE_JURISDICTION = ctx.options.jurisdiction;
    }

    // Worker-to-worker service bindings (see EnvironmentConfig.services).
    if (ctx.options.services?.length) {
      env.CLOUDFLARE_SERVICES = JSON.stringify(ctx.options.services);
    }

    // Two paths:
    //  - `--prebuilt`: in-process call to BuildCloudflareTask. Reads
    //    `dist/manifest.json` for resources/crons/containers, reads
    //    per-deploy values from process.env (set below), and writes a
    //    fresh `dist/wrangler.jsonc` + `dist/main.cloudflare.js`. No
    //    Vite, no spawn, no `alepha` binary needed at the workspace
    //    cwd  -  required for Rocket, which deploys a bare prebuilt
    //    tarball with no `node_modules`.
    //  - non-prebuilt: spawn the full `alepha build` for the CLI flow,
    //    which still needs Vite analyze + bundle.
    if (ctx.prebuilt) {
      await run({
        name: "alepha build --runtime=workerd --prebuilt (in-process)",
        handler: async () => {
          await this.runBuildInProcess(appDir, env);
        },
      });
      return;
    }

    const cmd = "alepha build --runtime=workerd";
    await run({
      name: cmd,
      handler: async () => {
        await this.runShell(cmd, {
          root: appDir,
          env,
        });
      },
    });
  }

  /**
   * Library-embed of `alepha build --runtime=workerd --prebuilt`. Loads the
   * pre-built `dist/manifest.json` through `this.fs`, puts the per-deploy env
   * vars ON THE CONTEXT, then runs `BuildCloudflareTask` against it.
   *
   * `ctx.alepha` is intentionally null  -  in manifest mode the task
   * reads resources/crons/containers from `ctx.manifest` and never
   * dereferences `ctx.alepha`. Same for `entry` and `hasClient`:
   * prebuilt mode skips the bundle tasks; only the wrangler.jsonc /
   * worker-entrypoint emission runs.
   */
  protected async runBuildInProcess(
    root: string,
    env: Record<string, string>,
  ): Promise<void> {
    const manifestPath = this.fs.join(root, "dist", "manifest.json");
    let manifest: BuildManifest;
    try {
      // ⚠️ Through `this.fs`, never `node:fs/promises`. This is the FIRST
      // thing a Lore deploy touches, and it unpacks the artifact into a
      // `MemoryFileSystemProvider`: a direct read defeats that substitution
      // and looks for a file on a disk the Worker does not have.
      manifest = JSON.parse(await this.fs.readTextFile(manifestPath));
    } catch (err) {
      throw new AlephaError(
        `Cannot read ${manifestPath}: ${(err as Error).message}. ` +
          `Prebuilt deploys require dist/manifest.json (emitted by \`alepha build --runtime=workerd\`).`,
      );
    }

    // Parsed rather than cast. Everything below builds a worker out of this
    // object without a live Alepha to check it against, so a manifest that is
    // truncated or from a different tool emits a worker with no bindings and
    // still reports success. Refused by name here instead, where the fix is
    // rebuilding the artifact.
    //
    // Refused, not fallen back on: unlike `infra.ts`'s `readManifest`, this
    // path has no introspection to fall through to  -  prebuilt mode exists
    // precisely because the app cannot be booted here.
    const validated = buildManifestSchema.safeParse(manifest);
    if (!validated.success) {
      throw new AlephaError(
        `${manifestPath} is not a valid build manifest: ` +
          `${validated.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`,
            )
            .join("; ")}. ` +
          `Rebuild the artifact with \`alepha build --runtime=workerd\`.`,
      );
    }
    manifest = validated.data;

    const ctx: BuildTaskContext = {
      // null at runtime  -  task takes the manifest path and never
      // dereferences alepha. Cast keeps the type signature happy.
      alepha: null as unknown as AlephaInstance,
      options: {
        // ⚠️ Declared, and there is no target any more. `BuildCloudflareTask`
        // is triggered by the presence of a workerd SLICE, because a
        // multi-slice build has no single target to name, and this path
        // regenerating `wrangler.jsonc` is a workerd build by definition.
        runtime: ["workerd"],
        runtimes: ["workerd"],
        output: { dist: "dist", public: "public" },
      },
      run: this.runner.run,
      root,
      entry: { root, server: "" },
      hasClient: false,
      manifest,
      flags: { prebuilt: true },
      // ⚠️ On the context, not on `process.env`. This used to SET each value
      // globally for the duration of the call and restore it after, which is
      // fine in a CLI process and a race inside Lore's Worker: two deploys
      // share an isolate, the second call's save captures the FIRST call's
      // values, and the first then finishes by restoring the second's. Nothing
      // about that failure looks like a race.
      //
      // Present means it is the whole environment - see `BuildTask.envOf` -
      // so a prebuilt deploy cannot inherit the host's `DATABASE_URL` for a
      // resource it never provisioned.
      env,
    };

    await this.buildTask.run(ctx);
  }

  // -------------------------------------------------------------------------
  // deploy (Cloudflare API, through WorkerCloudflareAdapter)
  // -------------------------------------------------------------------------

  /**
   * Upload the Worker, with its secrets and variables in the same upload.
   *
   * ## One deploy path (#Q2612)
   *
   * What is Node-side stays here: the artifact check, the secret set read
   * from `.env.<env>`, the declassified values written into the config. The
   * upload itself is `WorkerCloudflareAdapter.deploy` with `dist/` as its
   * root, the code Lore runs: modules scoped by the config's `rules`,
   * bindings, assets with `_headers` / `_redirects`, Durable Object
   * migrations, crons, the custom domain or `workers_dev`, queue consumers.
   * No wrangler process runs.
   *
   * ## ⚠️ One upload, one version, no window
   *
   * Secrets are `secret_text` bindings of the upload itself, first deploy
   * included, so the new build never runs against the previous secret set.
   * The declassified values (`variables`, `PUBLIC_URL`) are written into the
   * deploy config's `vars`, so they are `plain_text` bindings of the same
   * upload.
   *
   * ## ⚠️ Secrets add, they do not replace
   *
   * A secret the upload does not name stays on the Worker: Cloudflare carries
   * secret bindings over from the previous version (measured 2026-10-11, a
   * secret left out of the next upload was still bound to the new version).
   * That is what `wrangler deploy --secrets-file` did too, so a secret the
   * environment stopped declaring, or one set by hand in the dashboard, is
   * kept. Every such secret is named before the upload, so it is visible
   * rather than silently live.
   */
  async deploy(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    await this.validateDeployArtifact(ctx);
    const { credential } = await this.credentials.resolve({
      root: ctx.root,
      accountId: ctx.options.accountId,
      jurisdiction: ctx.options.jurisdiction,
    });
    const distDir = this.fs.join(ctx.root, "dist");
    const configPath = this.fs.join(distDir, "wrangler.jsonc");
    const { secrets, vars } = await this.resolveSecrets(ctx);

    if (Object.keys(vars).length > 0) {
      await this.writeDeployVars(configPath, vars);
    }
    await this.reportUndeclaredSecrets(ctx, credential, secrets, configPath);

    return await this.workerAdapter
      .use(credential)
      .withSecrets(secrets)
      .deploy({ ...ctx, root: distDir }, run);
  }

  /**
   * Log, by name, every secret the Worker holds that this environment no
   * longer declares, and answer those names.
   *
   * The upload leaves them bound (see {@link deploy}), so this is the only
   * place they surface: a stale credential still readable by the app, or a
   * value set by hand that no `.env` file records.
   *
   * ⚠️ Names only, never a value, and never a failure: a Worker that does not
   * exist yet holds nothing, and a listing that fails must not stop a deploy
   * that would otherwise succeed.
   */
  protected async reportUndeclaredSecrets(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    credential: WorkerCloudflareCredential,
    secrets: Record<string, string>,
    configPath: string,
  ): Promise<string[]> {
    let current: Array<{ name: string; type: string }>;
    try {
      current = await this.provisioner(credential).listSecrets(
        ctx.naming.worker(),
      );
    } catch (error) {
      this.log.debug(
        `Could not list the Worker's current secrets: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
    const config = JSON.parse(await this.fs.readTextFile(configPath)) as {
      vars?: Record<string, unknown>;
    };
    const kept = new Set([
      ...Object.keys(secrets),
      ...Object.keys(config.vars ?? {}),
    ]);
    // `WorkerCloudflareAdapter` derives PUBLIC_URL from the domain itself.
    if (ctx.options.domain) {
      kept.add("PUBLIC_URL");
    }
    const undeclared = current
      .filter((it) => it.type === "secret_text" && !kept.has(it.name))
      .map((it) => it.name)
      .sort();
    if (undeclared.length > 0) {
      this.log.warn(
        `The Worker keeps ${undeclared.length} secret(s) the environment no longer declares: ${undeclared.join(", ")}. A deploy never removes a secret; delete one with \`wrangler secret delete <name> --name ${ctx.naming.worker()}\` or in the dashboard, or declare it in .env.${ctx.env}.`,
      );
    }
    return undeclared;
  }

  /**
   * A provisioning client under the run's credential.
   */
  protected provisioner(
    credential: WorkerCloudflareCredential,
  ): CloudflareProvisionClient {
    return new CloudflareProvisionClient(credential);
  }

  /**
   * A deploy client under the run's credential, for the deployment reads
   * `inspect` makes.
   */
  protected deployer(
    credential: WorkerCloudflareCredential,
  ): CloudflareDeployClient {
    return new CloudflareDeployClient({
      ...credential,
      now: () => this.dateTime.nowMillis(),
    });
  }

  /**
   * Refuse incomplete local artifacts before any upload or config write.
   * Granular deployment uploads build output without regenerating it.
   */
  protected async validateDeployArtifact(ctx: InfraContext): Promise<void> {
    try {
      const dist = this.fs.join(ctx.root, "dist");
      const manifest = buildManifestSchema.parse(
        JSON.parse(
          await this.fs.readTextFile(this.fs.join(dist, "manifest.json")),
        ),
      );
      const slice = manifest.runtimes.find(
        (entry) => entry.runtime === "workerd",
      );
      const config = JSON.parse(
        await this.fs.readTextFile(this.fs.join(dist, "wrangler.jsonc")),
      );
      if (
        !slice?.entry ||
        !(await this.fs.exists(this.fs.join(dist, slice.entry))) ||
        typeof config.main !== "string" ||
        !(await this.fs.exists(this.fs.join(dist, config.main)))
      ) {
        throw new AlephaError(
          "Missing workerd slice or generated worker entry.",
        );
      }
    } catch (error) {
      throw new AlephaError(
        `Cannot deploy the local Cloudflare artifact: ${error instanceof Error ? error.message : String(error)} Build it with alepha build --runtime workerd, or run alepha deploy for the full pipeline.`,
      );
    }
  }

  /**
   * Merge the declassified values into the generated config's `vars`.
   *
   * ⚠️ The file is `build`'s output, regenerated on every `up`, so writing it
   * here changes nothing a later build reads. An explicit value wins over one
   * the build wrote, which is the precedence the post-deploy PATCH had.
   */
  protected async writeDeployVars(
    configPath: string,
    vars: Record<string, string>,
  ): Promise<void> {
    const config = JSON.parse(await this.fs.readTextFile(configPath)) as {
      vars?: Record<string, unknown>;
    };
    config.vars = { ...config.vars, ...vars };
    await this.fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  // -------------------------------------------------------------------------
  // secrets (resolved here, sent with the upload by `deploy`)
  // -------------------------------------------------------------------------

  /**
   * Vars that are handled by wrangler bindings or build config.
   * These should not be pushed as secrets.
   *
   * The list itself moved to `../secretKeys.ts` when {@link BayAdapter} needed
   * the same answer; this alias stays because it is what every existing caller
   * names (`infra.ts`'s plan output among them). Same Set, so nothing about
   * this adapter's behaviour changed.
   */
  static readonly EXCLUDED_SECRET_KEYS = SHARED_EXCLUDED_SECRET_KEYS;

  /**
   * Read the build manifest's `variables`: the keys the app declared
   * `secret: false`. Everything else on the allowlist is a secret, so an
   * unreadable manifest encrypts everything.
   */
  protected async readManifestVariables(
    root: string,
  ): Promise<string[] | undefined> {
    return await readManifestVariables(this.fs, root);
  }

  /**
   * What this deploy sends: the encrypted `secrets` and the declassified
   * `vars`, both empty when there is nothing to send.
   *
   * ⚠️ Read by {@link deploy}, which carries both in the one upload. There is
   * no `secrets()` step on this adapter any more; see `deploy`.
   */
  protected async resolveSecrets(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<{
    secrets: Record<string, string>;
    vars: Record<string, string>;
  }> {
    // The key set: `infra().secrets.keys`, else the manifest's `env` (or the
    // `.env.<env>` keys) unioned with the `.env.<env>.local` keys. Shared with
    // every adapter (`../secretKeys.ts`); the value resolves from
    // `.env.<env>[.local]` first, then `process.env`, so ambient runner vars
    // (PATH, GITHUB_*, ...) can never leak.
    const { keys, envVars } = await resolveSecretKeySet({
      fs: this.fs,
      envUtils: this.envUtils,
      root: ctx.root,
      env: ctx.env,
      keys: this.options?.secrets?.keys,
    });

    // Filter out binding/build vars, VITE_* vars, and empty values. Shared
    // with `BayAdapter` (`../secretKeys.ts`) because it is the security
    // boundary of both: `process.env` is consulted only for a key already on
    // `keys`, so ambient runner vars can never leak.
    const { secrets } = selectSecrets({
      keys,
      envVars,
      excluded: CloudflareAdapter.EXCLUDED_SECRET_KEYS,
    });

    // Auto-derive PUBLIC_URL from the configured domain so absolute links
    // (emails, OAuth callbacks, sitemap) resolve at runtime  -  the Worker
    // entrypoint lifts it into `alepha.env` via `loadEnv`. Honors an explicit
    // PUBLIC_URL in `.env.<env>` (already collected above); never overrides it.
    if (!secrets.PUBLIC_URL) {
      const url = this.publicUrl(ctx);
      if (url) {
        secrets.PUBLIC_URL = url;
      }
    }

    if (Object.keys(secrets).length === 0) {
      return { secrets: {}, vars: {} };
    }

    // Split off the keys the app declassified with `secret: false`. They are
    // pushed as `plain_text` bindings instead of `secret_text`: readable in the
    // dashboard, and  -  the point  -  editable there, which a write-only secret is
    // not. Everything not on the list stays encrypted, so a manifest without
    // the field (older artifact, or an app that annotated nothing) behaves
    // exactly as before.
    //
    // The allowlist is intersected rather than trusted wholesale: `variables`
    // is part of the manifest's allowlist, but `keys` may come from
    // `infra().secrets.keys` or `.env.<env>.local` instead, and a key an
    // orchestrator injected is not something the app vouched for.
    const publicKeys = new Set([
      ...CloudflareAdapter.ALWAYS_PUBLIC_KEYS,
      ...((await this.readManifestVariables(ctx.root)) ?? []),
    ]);
    const vars: Record<string, string> = {};
    for (const key of Object.keys(secrets)) {
      if (publicKeys.has(key)) {
        vars[key] = secrets[key];
        delete secrets[key];
      }
    }

    return { secrets, vars };
  }

  /**
   * Public base URL for this deploy, derived from the configured domain.
   * Returns undefined when no domain is set.
   */
  protected publicUrl(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): string | undefined {
    const host = ctx.options.domain;
    if (!host) {
      return undefined;
    }
    return `https://${host}`;
  }

  /**
   * Keys that are plaintext no matter what the app declared.
   *
   * `PUBLIC_URL` cannot go through the `secret: false` route the way every
   * other declassified key does: core carries it on the ambient `Env`
   * interface rather than in an `$env` schema, so it is not in `dump().env`
   * and can never reach the manifest's `publicVars`. It is also injected by
   * {@link resolveSecrets} itself, derived from the configured domain: a value this
   * adapter made up, which no app schema was ever consulted about.
   *
   * It being public is not a judgement call: it is the address the app answers
   * on, rendered into its own emails, sitemap and OAuth callbacks.
   */
  static readonly ALWAYS_PUBLIC_KEYS: ReadonlySet<string> = new Set([
    "PUBLIC_URL",
  ]);

  // -------------------------------------------------------------------------
  // provision (REST API)
  // -------------------------------------------------------------------------

  override async provision(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    const api = await this.provisionerFor(ctx);
    const needsDB = ctx.resources.hasDatabase;
    const needsBucket = ctx.resources.hasBucket;
    const postgres = needsDB && (await this.isPostgres(ctx));

    const tasks: Array<{ name: string; handler: () => Promise<void> }> = [];

    if (needsDB) {
      if (postgres) {
        const hdName = ctx.naming.hyperdrive();
        const envVars = await this.envUtils.parseEnv(ctx.root, [
          `.env.${ctx.env}`,
        ]);
        const dbUrl = envVars.DATABASE_URL ?? process.env.DATABASE_URL!;
        tasks.push({
          name: `provision hyperdrive (${hdName})`,
          handler: async () => {
            this.provisionedHyperdriveId = (
              await api.ensureHyperdrive(hdName, dbUrl)
            ).id;
          },
        });
      } else {
        const dbName = ctx.naming.d1();
        tasks.push({
          name: `provision d1 (${dbName})`,
          handler: async () => {
            // `weur`, what the CLI has always created with; making it
            // configurable is not #E75's (#Q2613).
            this.provisionedD1Id = (
              await api.ensureD1(dbName, { locationHint: "weur" })
            ).uuid;
          },
        });
      }
    }

    if (needsBucket) {
      const bucketName = ctx.naming.r2();
      tasks.push({
        name: `provision r2 (${bucketName})`,
        handler: async () => {
          await api.ensureR2(bucketName);
        },
      });
    }
    if (ctx.resources.hasKV) {
      const kvName = ctx.naming.kv();
      tasks.push({
        name: `provision kv (${kvName})`,
        handler: async () => {
          this.provisionedKVIds.set(kvName, (await api.ensureKV(kvName)).id);
        },
      });
    }

    if (ctx.resources.hasQueue) {
      const queueName = ctx.naming.queue();
      tasks.push({
        name: `provision queue (${queueName})`,
        handler: async () => {
          // The dead-letter queue too: the build names `<queue>-dlq` as the
          // consumer's, and the API refuses a consumer whose DLQ does not
          // exist. wrangler used to get away without it (#Q2613).
          await Promise.all([
            api.ensureQueue(queueName),
            api.ensureQueue(this.dlqName(queueName)),
          ]);
        },
      });
    }

    await run(tasks);
  }

  // -------------------------------------------------------------------------
  // migrate (wrangler  -  D1 migration runner)
  // -------------------------------------------------------------------------

  override async migrate(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    const needsDB = ctx.resources.hasDatabase;
    if (!needsDB) {
      return;
    }

    if (await this.isPostgres(ctx)) {
      await this.migratePostgres(ctx, run);
    } else {
      await this.migrateD1(ctx, run);
    }
  }

  override async exportDb(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
    options: ExportDbOptions = {},
  ): Promise<void> {
    if (!ctx.resources.hasDatabase) {
      throw new AlephaError(
        "No database detected for this app  -  nothing to export.",
      );
    }
    if (await this.isPostgres(ctx)) {
      throw new AlephaError(
        "Database export currently supports Cloudflare D1 only  -  Postgres/Hyperdrive export (pg_dump) is not implemented yet.",
      );
    }

    const dbName = ctx.naming.d1();
    const tmpDir = this.fs.join(ctx.root, "node_modules", ".alepha");
    const sqlPath = this.fs.join(tmpDir, `${dbName}.sql`);
    // D1 is SQLite  -  the natural local snapshot is the dev DB file that
    // `yarn dev` reads, so dev runs against a real remote snapshot.
    const dbPath = options.output ?? this.fs.join(tmpDir, "sqlite.db");

    await this.fs.mkdir(tmpDir, { recursive: true });

    await run(`wrangler d1 export ${dbName} --remote --output="${sqlPath}"`, {
      alias: `export D1 ${dbName} → ${sqlPath}`,
    });

    const escaped = await this.escapeNulBytes(sqlPath);
    if (escaped) {
      this.log.warn(
        `Escaped ${escaped} raw NUL byte(s) in the dump  -  sqlite3 would have refused it.`,
      );
    }

    // `sqlite3 '<db>' < dump.sql` aborts if the target already holds a
    // conflicting schema  -  start from a clean file. run() bypasses the
    // shell, so wrap the `<` redirection in `sh -c`.
    //
    // The clean file is a scratch one, NOT `dbPath`: sqlite3 commits every
    // statement it parsed before an error, so importing straight into the dev
    // DB meant a single failed export replaced a working database with a
    // silently partial one, and anyone who skimmed the error kept it.
    const stagingPath = `${dbPath}.import`;
    await this.fs.rm(stagingPath, { force: true });
    try {
      await run(`sh -c "sqlite3 '${stagingPath}' < '${sqlPath}'"`, {
        alias: `import dump → ${dbPath}`,
      });
      await this.fs.cp(stagingPath, dbPath);
    } finally {
      await this.fs.rm(stagingPath, { force: true });
    }

    if (!options.keepSql) {
      await this.fs.rm(sqlPath, { force: true });
    }

    // The dump carries rows, not objects: every file row now names a blob that
    // is still in R2, so the dev server would 404 once per row. Stand-ins stop
    // that. Skipped when the caller exported somewhere other than the dev DB,
    // since the storage directory only serves the dev server.
    if (options.placeholders !== false && !options.output) {
      await this.placeholders.fill({ dbPath, root: ctx.root });
    }
  }

  /**
   * Replace every raw NUL byte in a SQL dump with the two-character escape
   * `\0`, and report how many there were.
   *
   * The `sqlite3` CLI reads its input as C strings, so a `0x00` anywhere in
   * the dump ends that line early: the `INSERT` is never terminated, the
   * parser runs on into the next line looking for a closing quote, and the
   * syntax error is reported against the FOLLOWING row. One such byte makes a
   * whole export unimportable, and every D1 app is exposed to it, since D1
   * itself stores the byte happily.
   *
   * Escaping rather than stripping: a backslash is not special inside a SQLite
   * string literal, so `\0` is valid SQL and stores the two visible characters
   * that prose carrying a stray NUL almost always meant to carry in the first
   * place. Stripping would lose that silently.
   *
   * Rewrites nothing when the dump is clean, which is the normal case and
   * saves a round trip through tens of megabytes.
   */
  protected async escapeNulBytes(sqlPath: string): Promise<number> {
    const dump = await this.fs.readFile(sqlPath);
    // `latin1`, not the default utf8: this is spliced back into a byte buffer,
    // and the two characters have to stay two bytes.
    const escape = Buffer.from("\\0", "latin1");
    const parts: Array<Uint8Array> = [];
    let start = 0;
    let at = dump.indexOf(0, start);
    while (at !== -1) {
      parts.push(dump.subarray(start, at), escape);
      start = at + 1;
      at = dump.indexOf(0, start);
    }
    if (!parts.length) return 0;
    parts.push(dump.subarray(start));
    await this.fs.writeFile(sqlPath, Buffer.concat(parts));
    return parts.length >> 1;
  }

  protected async migrateD1(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    const dbName = ctx.naming.d1();

    await run({
      name: "migrate d1",
      handler: async () => {
        const migrationsDir = this.fs.join(ctx.root, "migrations", "sqlite");
        const dbUrl = this.provisionedD1Id
          ? `d1://${dbName}:${this.provisionedD1Id}`
          : `d1://${dbName}`;
        const env = { DATABASE_URL: dbUrl };

        // In prebuilt mode (Rocket) the tarball ships `migrations/`
        // straight from the build artifact  -  already checked + frozen
        // at pack time. Skip the live check/create cycle, which would
        // need to boot the user's app to introspect schema definitions
        // (impossible without the workspace's node_modules). For
        // non-prebuilt CLI deploys, still run the check (or create the
        // SQL when missing) so the deploy fails fast on a drifted
        // schema.
        if (!ctx.prebuilt) {
          if (await this.fs.exists(migrationsDir)) {
            await this.runShell(
              `alepha db migrations check --mode ${ctx.env}`,
              { resolve: true, env },
            );
          } else {
            await this.runShell(
              `alepha db migrations create --mode ${ctx.env}`,
              { resolve: true, env },
            );
          }
        }

        // Copy migrations to dist, apply, then clean up
        const distMigrations = this.fs.join(ctx.root, "dist", "migrations");
        await this.fs.cp(migrationsDir, distMigrations);

        await this.d1Migrations.apply(
          await this.provisionerFor(ctx),
          dbName,
          ctx.root,
          // Where the copy above put them.
          this.fs.join("dist", "migrations"),
        );

        await this.fs.rm(distMigrations, { recursive: true });
      },
    });
  }

  protected async migratePostgres(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    if (ctx.prebuilt) {
      // Postgres + Hyperdrive prebuilt deploys need a separate
      // migration story (an alepha-CLI-free `apply` against the
      // packed `migrations/postgres/` dir)  -  not implemented yet.
      // Rocket's v1 path is D1, which uses `wrangler d1 migrations
      // apply` and works fine in prebuilt mode.
      throw new AlephaError(
        "Postgres migrations are not yet supported in prebuilt mode. Use the `alepha deploy` CLI for now.",
      );
    }
    await run({
      name: "migrate postgres",
      handler: async () => {
        const envVars = await this.envUtils.parseEnv(ctx.root, [
          `.env.${ctx.env}`,
        ]);

        const env: Record<string, string> = {
          DATABASE_URL: envVars.DATABASE_URL ?? process.env.DATABASE_URL!,
        };

        if (envVars.POSTGRES_SCHEMA ?? process.env.POSTGRES_SCHEMA) {
          env.POSTGRES_SCHEMA = (envVars.POSTGRES_SCHEMA ??
            process.env.POSTGRES_SCHEMA)!;
        }

        await this.runShell(`alepha db migrations apply --mode ${ctx.env}`, {
          resolve: true,
          env,
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // inspect (REST API)
  // -------------------------------------------------------------------------

  async inspect(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<InfraState> {
    const credential = await this.credentialFor(ctx);
    const api = this.provisioner(credential);
    const state: InfraState = {
      workers: [],
      databases: [],
      buckets: [],
      kvNamespaces: [],
      queues: [],
      secrets: [],
    };

    const tasks: Array<{ name: string; handler: () => Promise<void> }> = [];

    // Workers
    {
      const name = ctx.naming.worker();

      tasks.push({
        name: `inspect worker (${name})`,
        handler: async () => {
          try {
            const deployment =
              await this.deployer(credential).activeDeployment(name);
            if (deployment) {
              state.workers.push({
                name,
                exists: true,
                version: deployment.versionId,
                tag: deployment.tag,
                createdAt: deployment.createdAt,
              });
            } else {
              state.workers.push({ name, exists: false });
            }
          } catch {
            state.workers.push({ name, exists: false });
          }
        },
      });
    }

    // Database
    const needsDB = ctx.resources.hasDatabase;
    if (needsDB) {
      if (await this.isPostgres(ctx)) {
        const hdName = ctx.naming.hyperdrive();
        tasks.push({
          name: `inspect hyperdrive (${hdName})`,
          handler: async () => {
            const configs = await api.listHyperdrive();
            const existing = configs.find((c) => c.name === hdName);
            state.databases.push({
              name: hdName,
              exists: !!existing,
              id: existing?.id,
              detail: existing?.origin.host,
            });
          },
        });
      } else {
        const dbName = ctx.naming.d1();
        tasks.push({
          name: `inspect d1 (${dbName})`,
          handler: async () => {
            const databases = await api.listD1();
            const existing = databases.find((db) => db.name === dbName);
            state.databases.push({
              name: dbName,
              exists: !!existing,
              id: existing?.uuid,
            });
          },
        });
      }
    }

    // R2
    const needsBucket = ctx.resources.hasBucket;
    if (needsBucket) {
      const bucketName = ctx.naming.r2();
      tasks.push({
        name: `inspect r2 (${bucketName})`,
        handler: async () => {
          const buckets = await api.listR2();
          const existing = buckets.find((b) => b.name === bucketName);
          state.buckets.push({
            name: bucketName,
            exists: !!existing,
            id: existing?.creation_date,
          });
        },
      });
    }
    if (ctx.resources.hasKV) {
      const kvName = ctx.naming.kv();
      tasks.push({
        name: `inspect kv (${kvName})`,
        handler: async () => {
          const namespaces = await api.listKV();
          const existing = namespaces.find((ns) => ns.title === kvName);
          state.kvNamespaces.push({
            name: kvName,
            exists: !!existing,
            id: existing?.id,
          });
        },
      });
    }
    if (ctx.resources.hasQueue) {
      const queueName = ctx.naming.queue();
      const names = [queueName, this.dlqName(queueName)];
      tasks.push({
        name: `inspect queue (${names.join(", ")})`,
        handler: async () => {
          const queues = await api.listQueues();
          for (const name of names) {
            const existing = queues.find((q) => q.queue_name === name);
            state.queues.push({
              name,
              exists: !!existing,
              id: existing?.queue_id,
            });
          }
        },
      });
    }

    // Secrets
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);
    const expectedSecrets = Object.keys(envVars).filter(
      (key) =>
        envVars[key] &&
        !CloudflareAdapter.EXCLUDED_SECRET_KEYS.has(key) &&
        !key.startsWith("VITE_"),
    );

    if (expectedSecrets.length > 0) {
      const workerName = ctx.naming.worker();
      tasks.push({
        name: "inspect secrets",
        handler: async () => {
          try {
            const deployed = await api.listSecrets(workerName);
            const deployedNames = new Set(deployed.map((s) => s.name));
            for (const key of expectedSecrets) {
              state.secrets.push({
                name: key,
                deployed: deployedNames.has(key),
              });
            }
          } catch {
            for (const key of expectedSecrets) {
              state.secrets.push({ name: key, deployed: false });
            }
          }
        },
      });
    }

    await run(tasks);

    return state;
  }

  // -------------------------------------------------------------------------
  // teardown (REST API)
  // -------------------------------------------------------------------------

  async teardown(
    ctx: InfraContext<CloudflareEnvironmentOptions>,
    run: RunnerMethod,
  ): Promise<void> {
    const api = await this.provisionerFor(ctx);
    if (ctx.resources.hasQueue) {
      const workerName = ctx.naming.worker();
      const queueName = ctx.naming.queue();
      await run({
        name: `unbind queue consumer ${queueName}`,
        handler: async () => {
          try {
            const queues = await api.listQueues();
            const queue = queues.find((q) => q.queue_name === queueName);
            if (queue) {
              await api.deleteQueueConsumer(queue.queue_id, workerName);
            }
          } catch (error: any) {
            this.log.warn(
              `Failed to unbind queue consumer: ${String(error.message || "")}`,
            );
          }
        },
      });
    }

    // 2. Delete workers
    {
      const name = ctx.naming.worker();
      await run({
        name: `delete worker ${name}`,
        handler: async () => {
          try {
            await api.deleteWorker(name);
          } catch (error: any) {
            this.log.warn(
              `Failed to delete worker ${name}: ${String(error.message || "")}`,
            );
          }
        },
      });
    }
    if (ctx.resources.hasQueue) {
      // The queue, then its dead-letter queue, which `provision` made beside
      // it. `deleteQueue` resolves the name and is quiet when it is gone.
      for (const name of [
        ctx.naming.queue(),
        this.dlqName(ctx.naming.queue()),
      ]) {
        await run({
          name: `delete queue ${name}`,
          handler: async () => {
            try {
              await api.deleteQueue(name);
            } catch (error: any) {
              this.log.warn(
                `Failed to delete queue ${name}: ${String(error.message || "")}`,
              );
            }
          },
        });
      }
    }
    if (ctx.resources.hasKV) {
      const name = ctx.naming.kv();
      await run({
        name: `delete kv ${name}`,
        handler: async () => {
          try {
            const namespaces = await api.listKV();
            const existing = namespaces.find((ns) => ns.title === name);
            if (!existing) {
              this.log.debug(`KV namespace ${name} not found  -  skipping.`);
              return;
            }
            await api.deleteKV(existing.id);
          } catch (error: any) {
            this.log.warn(
              `Failed to delete kv ${name}: ${String(error.message || "")}`,
            );
          }
        },
      });
    }

    // 5. Delete R2 bucket. An empty bucket is removed by the REST DELETE
    // directly; only a non-empty one needs an S3 wipe first. Crucially the
    // wipe is NOT a precondition of the delete  -  a wipe that can't run (no
    // creds) must never strand an otherwise-deletable bucket.
    const needsBucket = ctx.resources.hasBucket;
    if (needsBucket) {
      const name = ctx.naming.r2();
      await run({
        name: `delete r2 ${name}`,
        handler: async () => {
          try {
            await this.deleteR2Bucket(api, name, ctx);
          } catch (error: any) {
            const msg = String(error.message || "");
            if (this.isMissingBucketError(msg)) {
              this.log.debug(`Bucket ${name} not found  -  skipping.`);
            } else {
              this.log.warn(`Failed to delete r2 ${name}: ${msg}`);
            }
          }
        },
      });
    }

    // 6. Delete D1 or Hyperdrive
    const needsDB = ctx.resources.hasDatabase;
    if (needsDB) {
      if (await this.isPostgres(ctx)) {
        const name = ctx.naming.hyperdrive();
        await run({
          name: `delete hyperdrive ${name}`,
          handler: async () => {
            try {
              const configs = await api.listHyperdrive();
              const existing = configs.find((c) => c.name === name);
              if (!existing) {
                this.log.debug(`Hyperdrive ${name} not found  -  skipping.`);
                return;
              }
              await api.deleteHyperdrive(existing.id);
            } catch (error: any) {
              this.log.warn(
                `Failed to delete hyperdrive ${name}: ${String(error.message || "")}`,
              );
            }
          },
        });
      } else {
        const name = ctx.naming.d1();
        await run({
          name: `delete d1 ${name}`,
          handler: async () => {
            try {
              const databases = await api.listD1();
              const existing = databases.find((db) => db.name === name);
              if (!existing) {
                this.log.debug(`D1 database ${name} not found  -  skipping.`);
                return;
              }
              await api.deleteD1(existing.uuid);
            } catch (error: any) {
              this.log.warn(
                `Failed to delete d1 ${name}: ${String(error.message || "")}`,
              );
            }
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Resource helpers (REST API)
  // -------------------------------------------------------------------------

  /**
   * The dead-letter queue `BuildCloudflareTask.enhanceQueue` names for the
   * job queue, unless `CLOUDFLARE_QUEUE_DLQ_NAME` overrides it (a queue the
   * app then owns).
   */
  protected dlqName(queueName: string): string {
    return `${queueName}-dlq`;
  }

  /**
   * Whether a Cloudflare error message indicates the bucket is already gone.
   */
  protected isMissingBucketError(msg: string): boolean {
    return (
      msg.includes("does not exist") ||
      msg.includes("NoSuchBucket") ||
      msg.includes("bucket not found")
    );
  }

  /**
   * Resolve S3 credentials for wiping an R2 bucket over the S3 protocol.
   *
   * Prefers the account's R2 S3 credentials from the environment
   * (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`)  -  these are already
   * provisioned for the deploy (artifact registry) and are account-scoped,
   * so they can empty any bucket without minting anything. Returns `null`
   * when not configured, letting the caller fall back to token minting.
   */
  protected resolveR2Credentials(): {
    accessKeyId: string;
    secretAccessKey: string;
  } | null {
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey };
    }
    return null;
  }

  /**
   * Delete an R2 bucket, emptying it first only when necessary.
   *
   * Cloudflare's REST `DELETE /r2/buckets/:name` succeeds on an empty bucket
   * but rejects a non-empty one. So we attempt the delete directly (the
   * common teardown case  -  no objects, no creds needed), and only on failure
   * empty the bucket over the S3 protocol and retry. A missing bucket is a
   * no-op, so teardown is idempotent.
   */
  protected async deleteR2Bucket(
    api: CloudflareProvisionClient,
    name: string,
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<void> {
    try {
      await api.deleteR2Bucket(name);
      return;
    } catch (error: any) {
      const msg = String(error.message || "");
      if (this.isMissingBucketError(msg)) {
        return; // already gone
      }
      // Most often the bucket is non-empty  -  empty it then retry once.
      this.log.debug(
        `Direct delete of r2 ${name} failed (${msg}); emptying then retrying.`,
      );
    }

    await this.wipeR2Bucket(api, name, ctx);

    try {
      await api.deleteR2Bucket(name);
    } catch (error: any) {
      const msg = String(error.message || "");
      if (this.isMissingBucketError(msg)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Empty an R2 bucket via the S3-compatible API.
   *
   * Cloudflare's REST API has no object-level endpoints  -  objects must be
   * listed and deleted over the S3 protocol. We use the account's R2 S3
   * credentials (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) when present;
   * otherwise we fall back to minting a short-lived bucket-scoped token via
   * the CF API (requires a user-scoped `CLOUDFLARE_API_TOKEN`) and revoke it
   * after. When neither is available the wipe is skipped with a warning  -
   * the caller still attempts the delete, which succeeds for empty buckets.
   *
   * Also aborts any pending multipart uploads  -  those count as bucket
   * contents from R2's perspective and would otherwise block the delete.
   */
  protected async wipeR2Bucket(
    api: CloudflareProvisionClient,
    bucketName: string,
    ctx: InfraContext<CloudflareEnvironmentOptions>,
  ): Promise<void> {
    let creds = this.resolveR2Credentials();
    let mintedTokenId: string | undefined;

    if (!creds) {
      // No env S3 creds  -  try minting a bucket-scoped token. This needs a
      // user-scoped `CLOUDFLARE_API_TOKEN`; an account-scoped one (or the
      // wrangler OAuth bearer) can't mint, so we skip rather than throw and
      // let the caller's delete attempt proceed (fine for empty buckets).
      if (!process.env.CLOUDFLARE_API_TOKEN) {
        this.log.warn(
          `Skipping R2 wipe for ${bucketName}: no S3 credentials ` +
            `(S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY) and no ` +
            `CLOUDFLARE_API_TOKEN to mint a bucket-scoped token. A non-empty ` +
            `bucket must be emptied manually in the Cloudflare dashboard.`,
        );
        return;
      }
      try {
        const tokenName = `alepha-teardown-${bucketName}-${this.dateTime.nowMillis()}`;
        const token = await api.createR2Token(tokenName, bucketName);
        mintedTokenId = token.id;
        creds = {
          accessKeyId: token.accessKeyId,
          secretAccessKey: token.secretAccessKey,
        };
      } catch (error: any) {
        this.log.warn(
          `Skipping R2 wipe for ${bucketName}: could not mint an R2 token ` +
            `(${String(error.message || "")}). Set S3_ACCESS_KEY_ID / ` +
            `S3_SECRET_ACCESS_KEY for reliable teardown.`,
        );
        return;
      }
    }

    try {
      const accountId = api.account;
      const jur = ctx.options.jurisdiction;
      const host = jur
        ? `${accountId}.${jur}.r2.cloudflarestorage.com`
        : `${accountId}.r2.cloudflarestorage.com`;

      const client = new S3mini({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        region: "auto",
        endpoint: `https://${host}/${bucketName}`,
      });

      // Abort pending multipart uploads. R2 surfaces these as bucket contents
      // and they block deletion even after all completed objects are gone.
      try {
        const mp = await client.listMultipartUploads();
        if ("listMultipartUploadsResult" in mp) {
          const uploads = mp.listMultipartUploadsResult.uploads ?? [];
          for (const upload of uploads) {
            const u = upload as unknown as {
              Key?: string;
              key?: string;
              UploadId?: string;
              uploadId?: string;
            };
            const key = u.Key ?? u.key;
            const uploadId = u.UploadId ?? u.uploadId;
            if (key && uploadId) {
              await client.abortMultipartUpload(key, uploadId);
            }
          }
        }
      } catch (error: any) {
        this.log.debug(
          `listMultipartUploads on ${bucketName} failed: ${String(error.message || "")}`,
        );
      }

      // Page through objects and delete in batches of up to 1000 (S3 cap).
      let cursor: string | undefined;
      let total = 0;
      while (true) {
        const page = await client.listObjectsPaged(
          undefined,
          undefined,
          1000,
          cursor,
        );
        const objects = page?.objects ?? [];
        if (objects.length === 0) {
          break;
        }
        await client.deleteObjects(objects.map((o) => o.Key));
        total += objects.length;
        cursor = page?.nextContinuationToken;
        if (!cursor) {
          break;
        }
      }

      if (total > 0) {
        this.log.info(`Emptied ${total} object(s) from bucket ${bucketName}.`);
      }
    } finally {
      // Revoke only a token we minted here  -  env S3 creds are long-lived and
      // must not be deleted. Always revoke, even if the wipe failed mid-way.
      if (mintedTokenId) {
        try {
          await api.deleteR2Token(mintedTokenId);
        } catch (error: any) {
          this.log.warn(
            `Failed to revoke ephemeral R2 token ${mintedTokenId}: ${String(error.message || "")}`,
          );
        }
      }
    }
  }
}
