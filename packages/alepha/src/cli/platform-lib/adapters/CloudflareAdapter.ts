import { randomBytes, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  $inject,
  $state,
  Alepha,
  AlephaError,
  type Alepha as AlephaInstance,
} from "alepha";
import {
  BuildCloudflareTask,
  type BuildManifest,
  type BuildTaskContext,
} from "alepha/cli";
import { EnvUtils, Runner, type RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { S3mini } from "s3mini";
import { platformOptions } from "../atoms/platformOptions.ts";
import { PlatformCacheProvider } from "../providers/PlatformCacheProvider.ts";
import { CloudflareApi } from "../services/CloudflareApi.ts";
import { tenantDomain } from "../services/NamingService.ts";
import { WranglerApi } from "../services/WranglerApi.ts";
import {
  type AppContext,
  type ExportDbOptions,
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Cloudflare Workers adapter.
 *
 * Uses the Cloudflare REST API (via CloudflareApi) for resource provisioning
 * and teardown, and wrangler CLI (via WranglerApi) for login, deploy,
 * D1 migrations, and secret bulk push.
 */
export class CloudflareAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly cache = $inject(PlatformCacheProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly api = $inject(CloudflareApi);
  protected readonly wrangler = $inject(WranglerApi);
  protected readonly runner = $inject(Runner);
  protected readonly buildTask = $inject(BuildCloudflareTask);
  protected readonly options = $state(platformOptions);

  protected provisionedD1Id?: string;
  protected provisionedHyperdriveId?: string;
  protected provisionedKVIds = new Map<string, string>();

  /**
   * Check if the user's DATABASE_URL points to an external Postgres database.
   * If so, we use Hyperdrive instead of D1.
   *
   * Reads from `.env.{env}` first, falls back to `process.env`.
   */
  protected async isPostgres(ctx: PlatformContext): Promise<boolean> {
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);
    const dbUrl = envVars.DATABASE_URL ?? process.env.DATABASE_URL;
    return !!dbUrl?.startsWith("postgres:");
  }

  /**
   * Propagate the environment's data-jurisdiction setting to the API client.
   *
   * Must be invoked at the top of every entry point (authenticate, build,
   * deploy, secrets, provision, migrate, inspect, teardown) because
   * CloudflareApi is a singleton reused across env invocations.
   */
  protected configureApi(ctx: PlatformContext): void {
    this.api.setJurisdiction(ctx.envConfig.jurisdiction);
    this.api.setAccountId(ctx.envConfig.accountId);
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
   * scopes the token, and a second store would drift from the one every other
   * wrangler invocation reads.
   */
  async login(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    await run({
      name: "wrangler login",
      handler: async () => {
        await this.wrangler.ensureInstalled(ctx.root);
        await this.wrangler.login();
      },
    });
  }

  async logout(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    await run({
      name: "wrangler logout",
      handler: async () => {
        await this.wrangler.ensureInstalled(ctx.root);
        await this.shell.run("wrangler logout", { root: ctx.root });
      },
    });
  }

  async authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    this.configureApi(ctx);
    await run({
      name: "authenticate",
      handler: async () => {
        await this.wrangler.ensureInstalled(ctx.root);

        // Always validate the token — refresh tokens can expire between runs
        // even when the cache TTL hasn't elapsed.
        let needsLogin = false;

        try {
          await this.wrangler.getAuthToken();
        } catch {
          needsLogin = true;
        }

        if (needsLogin) {
          await this.wrangler.login();
        }

        // Skip account resolution if cache is fresh
        if (await this.cache.isLoginFresh(ctx.root, "cloudflare")) {
          return;
        }

        // Resolve account ID via REST API (typed, no regex)
        try {
          const accountId = await this.api.resolveAccountId();
          await this.cache.recordLogin(ctx.root, "cloudflare", accountId);
        } catch {
          await this.cache.recordLogin(ctx.root, "cloudflare");
        }
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
   * generated `wrangler.jsonc` silently came out with no D1 binding — or a KV
   * binding with an empty id — and the deploy shipped a worker with no
   * database. Nothing failed; the worker just 500'd on first query.
   *
   * Lookup only: this never creates anything (that is `provision`'s job). A
   * resource the app needs but the account does not have is a hard error, not
   * a silently missing binding.
   */
  protected async resolveExistingResourceIds(ctx: AppContext): Promise<void> {
    if (ctx.resources.hasDatabase && !this.provisionedD1Id) {
      if (this.provisionedHyperdriveId) {
        // Hyperdrive already resolved — nothing to look up.
      } else if (await this.isPostgres(ctx)) {
        const name = ctx.naming.hyperdrive();
        const found = (await this.api.listHyperdrive()).find(
          (it) => it.name === name,
        );
        if (!found) {
          throw new AlephaError(
            `Hyperdrive config '${name}' does not exist. Run 'alepha platform provision' before building.`,
          );
        }
        this.provisionedHyperdriveId = found.id;
      } else {
        const name = ctx.naming.d1();
        const found = (await this.api.listD1()).find((it) => it.name === name);
        if (!found) {
          throw new AlephaError(
            `D1 database '${name}' does not exist. Run 'alepha platform provision' before building.`,
          );
        }
        this.provisionedD1Id = found.uuid;
      }
    }

    if (ctx.resources.hasKV) {
      const name = ctx.naming.kv();
      if (!this.provisionedKVIds.has(name)) {
        const found = (await this.api.listKV()).find((it) => it.title === name);
        if (!found) {
          throw new AlephaError(
            `KV namespace '${name}' does not exist. Run 'alepha platform provision' before building.`,
          );
        }
        this.provisionedKVIds.set(name, found.id);
      }
    }
  }

  async build(ctx: AppContext, run: RunnerMethod): Promise<void> {
    this.configureApi(ctx);
    await this.resolveExistingResourceIds(ctx);
    const appDir = ctx.root;

    const env: Record<string, string> = {};

    // An app can declare object storage either with `$storage` or by
    // setting R2_BUCKET_NAME itself (the "blobs without a database" route,
    // where nothing observable at build time reveals the need — see
    // BuildCloudflareTask.writeManifest). Forward an explicit value into
    // the build so resource detection can see it.
    const declaredBucket = (
      await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`])
    ).R2_BUCKET_NAME;
    if (declaredBucket) {
      env.R2_BUCKET_NAME = declaredBucket;
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

    // For a tenanted deploy the host is `<tenant>.<domain>`; otherwise the
    // configured domain is used as-is. (V2 custom-domain override plugs in
    // via tenantDomain's third arg.)
    const host = tenantDomain(ctx.envConfig.domain, ctx.tenant);
    if (host) {
      // A wildcard host needs a CF zone for its Worker route, but `zone` is
      // optional: when omitted the build derives it from the domain's last two
      // labels (BuildCloudflareTask). Set it only to override that default.
      env.CLOUDFLARE_DOMAIN = host;
      if (ctx.envConfig.zone) {
        env.CLOUDFLARE_ZONE = ctx.envConfig.zone;
      }
    }

    if (ctx.envConfig.jurisdiction) {
      env.CLOUDFLARE_JURISDICTION = ctx.envConfig.jurisdiction;
    }

    // Worker-to-worker service bindings (see EnvironmentConfig.services).
    if (ctx.envConfig.services?.length) {
      env.CLOUDFLARE_SERVICES = JSON.stringify(ctx.envConfig.services);
    }

    // Two paths:
    //  - `--prebuilt`: in-process call to BuildCloudflareTask. Reads
    //    `dist/manifest.json` for resources/crons/containers, reads
    //    per-tenant values from process.env (set below), and writes a
    //    fresh `dist/wrangler.jsonc` + `dist/main.cloudflare.js`. No
    //    Vite, no spawn, no `alepha` binary needed at the workspace
    //    cwd — required for Rocket, which deploys a bare prebuilt
    //    tarball with no `node_modules`.
    //  - non-prebuilt: spawn the full `alepha build` for the CLI flow,
    //    which still needs Vite analyze + bundle.
    if (ctx.prebuilt) {
      await run({
        name: "alepha build -t cloudflare --prebuilt (in-process)",
        handler: async () => {
          await this.runBuildInProcess(appDir, env);
        },
      });
      return;
    }

    const cmd = "alepha build -t cloudflare";
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
   * Library-embed of `alepha build -t cloudflare --prebuilt`. Loads the
   * pre-built `dist/manifest.json`, sets the per-tenant env vars on
   * `process.env` for the duration of the call (the task's enhance*
   * methods read them directly), then runs `BuildCloudflareTask`
   * against a synthetic context.
   *
   * `ctx.alepha` is intentionally null — in manifest mode the task
   * reads resources/crons/containers from `ctx.manifest` and never
   * dereferences `ctx.alepha`. Same for `entry` and `hasClient`:
   * prebuilt mode skips the bundle tasks; only the wrangler.jsonc /
   * worker-entrypoint emission runs.
   */
  protected async runBuildInProcess(
    root: string,
    env: Record<string, string>,
  ): Promise<void> {
    const manifestPath = join(root, "dist", "manifest.json");
    let manifest: BuildManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    } catch (err) {
      throw new AlephaError(
        `Cannot read ${manifestPath}: ${(err as Error).message}. ` +
          `Prebuilt deploys require dist/manifest.json (emitted by \`alepha build -t cloudflare\`).`,
      );
    }

    const ctx: BuildTaskContext = {
      // null at runtime — task takes the manifest path and never
      // dereferences alepha. Cast keeps the type signature happy.
      alepha: null as unknown as AlephaInstance,
      options: {
        target: "cloudflare",
        output: { dist: "dist", public: "public" },
      },
      run: this.runner.run,
      root,
      entry: { root, server: "" },
      hasClient: false,
      manifest,
      platformOptions: null,
      flags: { prebuilt: true },
    };

    const previous: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      previous[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      await this.buildTask.run(ctx);
    } finally {
      for (const [k, prev] of Object.entries(previous)) {
        if (prev === undefined) delete process.env[k];
        else process.env[k] = prev;
      }
    }
  }

  // -------------------------------------------------------------------------
  // deploy (wrangler — handles bundling/upload)
  // -------------------------------------------------------------------------

  async deploy(
    ctx: AppContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    this.configureApi(ctx);
    const workerName = ctx.naming.worker();
    const distDir = this.fs.join(ctx.root, "dist");

    let url: string | undefined;

    await run({
      name: `deploy worker ${ctx.project}`,
      handler: async () => {
        url = await this.wrangler.deploy(
          workerName,
          `${distDir}/wrangler.jsonc`,
          ctx.root,
        );
      },
    });

    return url;
  }

  // -------------------------------------------------------------------------
  // secrets (wrangler — bulk push)
  // -------------------------------------------------------------------------

  /**
   * Vars that are handled by wrangler bindings or build config.
   * These should not be pushed as secrets.
   */
  static readonly EXCLUDED_SECRET_KEYS = new Set([
    "DATABASE_URL",
    "R2_BUCKET_NAME",
    "CLOUDFLARE_DOMAIN",
    "CLOUDFLARE_ZONE",
    "CLOUDFLARE_JURISDICTION",
    "HYPERDRIVE_ID",
    "POSTGRES_SCHEMA",
    "NODE_ENV",
    // Framework infra knobs (have defaults, never worker secrets). The
    // manifest's `env` auto-list surfaces every declared `$env` key, so
    // exclude these here to keep them out of the secret push even when a CI
    // runner happens to set them (LOG_LEVEL, DEBUG, etc.).
    "LOG_LEVEL",
    "LOG_FORMAT",
    "SERVER_HOST",
    "SERVER_PORT",
    "TRUST_PROXY",
    "REACT_SSR_ENABLED",
    "DATABASE_SYNC",
    "DEBUG",
  ]);

  /**
   * Read the build manifest's `env` list (every key the app declares via
   * `$env`) from `dist/manifest.json`. Used as the default worker-secret
   * allowlist. Returns `undefined` when the manifest is absent or predates
   * the `env` field, so the caller falls back to the `.env` file keys.
   */
  protected async readManifestEnvKeys(
    root: string,
  ): Promise<string[] | undefined> {
    try {
      const manifest = await this.fs.readJsonFile<Partial<BuildManifest>>(
        this.fs.join(root, "dist", "manifest.json"),
      );
      return Array.isArray(manifest.env) ? manifest.env : undefined;
    } catch {
      return undefined;
    }
  }

  override async secrets(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    this.configureApi(ctx);
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);

    // The key set to push, by precedence:
    //   1. `platform.secrets.keys` — explicit override in alepha.config.ts.
    //   2. otherwise the UNION of:
    //      a. `dist/manifest.json` `env` — every key the app declares via
    //         `$env`, captured at build time (or the `.env.<env>` file keys as
    //         a legacy fallback for artifacts built before the manifest carried
    //         `env`). Lets CI deliver declared secrets from `process.env` with
    //         no file on the runner.
    //      b. `.env.<env>.local` keys — the per-deploy override layer. External
    //         orchestrators (Alepha Rocket) write injected `config.vars` +
    //         `config.secrets` (e.g. CLUB_CONFIG_JSON, per-tenant OAuth) here,
    //         and those must reach the worker even though the prebuilt app
    //         never declared them. Only `.local` is unioned, NOT the base
    //         `.env.<env>` — so local infra creds (CLOUDFLARE_API_TOKEN, …)
    //         can't leak in.
    // In every case the value resolves from `.env.<env>[.local]` first, then
    // `process.env`; ambient runner vars (PATH, GITHUB_*, …) can never leak.
    const declaredKeys = this.options?.secrets?.keys;
    const manifestKeys = await this.readManifestEnvKeys(ctx.root);
    const localKeys = Object.keys(
      await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}.local`]),
    );
    const keys =
      declaredKeys ??
      Array.from(
        new Set([...(manifestKeys ?? Object.keys(envVars)), ...localKeys]),
      );

    // Filter out binding/build vars, VITE_* vars, and empty values
    const secrets: Record<string, string> = {};
    for (const key of keys) {
      if (CloudflareAdapter.EXCLUDED_SECRET_KEYS.has(key)) continue;
      if (key.startsWith("VITE_")) continue;
      const value = envVars[key] ?? process.env[key];
      if (!value) continue;
      secrets[key] = value;
    }

    // Auto-derive PUBLIC_URL from the configured domain so absolute links
    // (emails, OAuth callbacks, sitemap) resolve at runtime — the Worker
    // entrypoint lifts it into `alepha.env` via `loadEnv`. Honors an explicit
    // PUBLIC_URL in `.env.<env>` (already collected above); never overrides it.
    if (!secrets.PUBLIC_URL) {
      const url = this.publicUrl(ctx);
      if (url) {
        secrets.PUBLIC_URL = url;
      }
    }

    if (Object.keys(secrets).length === 0) {
      return;
    }

    // Push all secrets for a worker in a single PATCH so each `up` only
    // mints one new deployment for the secrets step (regardless of how many
    // are being updated). Loop-based `putSecret` worked but generated N
    // deployment rows per push, cluttering the CF dashboard.
    //
    // Skip the PATCH entirely when nothing changed: we stamp a sha256 of the
    // sorted secret set onto the worker as a plain_text binding called
    // `ALEPHA_SECRETS_HASH`. On the next deploy we GET the settings, compare
    // the stored hash to the freshly-computed one, and bail out if they
    // match. The hash lives on Cloudflare (not on disk), so the cache works
    // identically in CI and locally.
    //
    // Net deploy count per `up`:
    //   - code change, secrets unchanged: 1 (wrangler deploy only)
    //   - secrets changed:                 2 (wrangler deploy + bulk PATCH)
    //
    // Implementation mirrors `wrangler secret bulk`:
    //   1. GET current worker bindings via `/script/{name}/settings`.
    //   2. Compare ALEPHA_SECRETS_HASH binding to local hash → skip on match.
    //   3. Keep all non-secret bindings (D1, R2, KV, etc.) and any secret
    //      bindings we are NOT overwriting (forwarded as `{type,name}` only
    //      — CF preserves their stored values).
    //   4. Add/overwrite secrets as `{type,name,text}`, plus a fresh
    //      ALEPHA_SECRETS_HASH binding so subsequent runs see it.
    //   5. PATCH the merged binding list in one call.
    {
      const workerName = ctx.naming.worker();

      await run({
        name: `push secrets to ${workerName} (bulk)`,
        handler: async () => {
          const settings = await this.api.getWorkerSettings(workerName);
          const existingBindings = settings.bindings ?? [];

          const existingHashBinding = existingBindings.find(
            (b) =>
              b.type === "plain_text" &&
              b.name === CloudflareAdapter.SECRETS_HASH_BINDING,
          );

          // Recompute against the STORED salt: matching means the secret set
          // is unchanged and the PATCH can be skipped.
          const existing = parseSecretsFingerprint(existingHashBinding?.text);
          if (
            existing &&
            computeSecretsHash(secrets, existing.salt) === existing.digest
          ) {
            this.log.info(
              `Secrets for ${workerName} unchanged (${existing.digest.slice(0, 8)}…), skipping push.`,
            );
            return;
          }

          const salt = randomBytes(16).toString("hex");
          const fingerprint = `v2:${salt}:${computeSecretsHash(secrets, salt)}`;

          const overwriting = new Set(Object.keys(secrets));
          const inherit = existingBindings
            .filter(
              (b) =>
                // Drop the old hash binding — we'll write a fresh one below.
                !(
                  b.type === "plain_text" &&
                  b.name === CloudflareAdapter.SECRETS_HASH_BINDING
                ) &&
                // Drop secret bindings we're about to overwrite. Keep the
                // rest of the bindings (D1, R2, KV, untouched secrets) as
                // `{type,name}` only — CF preserves stored values.
                (b.type !== "secret_text" || !overwriting.has(b.name)),
            )
            .map((b) => ({ type: b.type, name: b.name }));

          const upsert = Object.entries(secrets).map(([name, text]) => ({
            type: "secret_text" as const,
            name,
            text,
          }));

          await this.api.patchWorkerBindings(workerName, [
            ...inherit,
            ...upsert,
            {
              type: "plain_text",
              name: CloudflareAdapter.SECRETS_HASH_BINDING,
              text: fingerprint,
            },
          ]);
        },
      });
    }
  }

  /**
   * Public base URL for this deploy, derived from the configured domain
   * (honoring tenant subdomains). Returns undefined when no domain is set or
   * the host is a wildcard — there's no single resolvable origin to point at.
   */
  protected publicUrl(ctx: PlatformContext): string | undefined {
    const host = tenantDomain(ctx.envConfig.domain, ctx.tenant);
    if (!host || host.includes("*")) {
      return undefined;
    }
    return `https://${host}`;
  }

  /**
   * Plain-text binding used to fingerprint the deployed secret set so the
   * next `up` can skip the PATCH when nothing has changed.
   */
  static readonly SECRETS_HASH_BINDING = "ALEPHA_SECRETS_HASH";

  // -------------------------------------------------------------------------
  // provision (REST API)
  // -------------------------------------------------------------------------

  override async provision(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    this.configureApi(ctx);
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
            this.provisionedHyperdriveId = await this.ensureHyperdrive(
              hdName,
              dbUrl,
            );
          },
        });
      } else {
        const dbName = ctx.naming.d1();
        tasks.push({
          name: `provision d1 (${dbName})`,
          handler: async () => {
            this.provisionedD1Id = await this.ensureD1(dbName);
          },
        });
      }
    }

    if (needsBucket) {
      const bucketName = ctx.naming.r2();
      tasks.push({
        name: `provision r2 (${bucketName})`,
        handler: async () => {
          await this.ensureR2(bucketName);
        },
      });
    }
    if (ctx.resources.hasKV) {
      const kvName = ctx.naming.kv();
      tasks.push({
        name: `provision kv (${kvName})`,
        handler: async () => {
          this.provisionedKVIds.set(kvName, await this.ensureKV(kvName));
        },
      });
    }

    if (ctx.resources.hasQueue) {
      const queueName = ctx.naming.queue();
      tasks.push({
        name: `provision queue (${queueName})`,
        handler: async () => {
          await this.ensureQueue(queueName);
        },
      });
    }

    await run(tasks);
  }

  // -------------------------------------------------------------------------
  // migrate (wrangler — D1 migration runner)
  // -------------------------------------------------------------------------

  override async migrate(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    this.configureApi(ctx);
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
    ctx: PlatformContext,
    run: RunnerMethod,
    options: ExportDbOptions = {},
  ): Promise<void> {
    this.configureApi(ctx);
    if (!ctx.resources.hasDatabase) {
      throw new AlephaError(
        "No database detected for this app — nothing to export.",
      );
    }
    if (await this.isPostgres(ctx)) {
      throw new AlephaError(
        "Database export currently supports Cloudflare D1 only — Postgres/Hyperdrive export (pg_dump) is not implemented yet.",
      );
    }

    const dbName = ctx.naming.d1();
    const tmpDir = this.fs.join(ctx.root, "node_modules", ".alepha");
    const sqlPath = this.fs.join(tmpDir, `${dbName}.sql`);
    // D1 is SQLite — the natural local snapshot is the dev DB file that
    // `yarn dev` reads, so dev runs against a real remote snapshot.
    const dbPath = options.output ?? this.fs.join(tmpDir, "sqlite.db");

    await this.fs.mkdir(tmpDir, { recursive: true });

    await run(`wrangler d1 export ${dbName} --remote --output="${sqlPath}"`, {
      alias: `export D1 ${dbName} → ${sqlPath}`,
    });

    // `sqlite3 '<db>' < dump.sql` aborts if the target already holds a
    // conflicting schema — start from a clean file. run() bypasses the
    // shell, so wrap the `<` redirection in `sh -c`.
    await this.fs.rm(dbPath, { force: true });
    await run(`sh -c "sqlite3 '${dbPath}' < '${sqlPath}'"`, {
      alias: `import dump → ${dbPath}`,
    });

    if (!options.keepSql) {
      await this.fs.rm(sqlPath, { force: true });
    }
  }

  protected async migrateD1(
    ctx: PlatformContext,
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
        // straight from the build artifact — already checked + frozen
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

        // Copy migrations to dist for wrangler, apply, then clean up
        const distMigrations = this.fs.join(ctx.root, "dist", "migrations");
        await this.fs.cp(migrationsDir, distMigrations);

        await this.wrangler.d1MigrationsApply(
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
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    if (ctx.prebuilt) {
      // Postgres + Hyperdrive prebuilt deploys need a separate
      // migration story (an alepha-CLI-free `apply` against the
      // packed `migrations/postgres/` dir) — not implemented yet.
      // Rocket's v1 path is D1, which uses `wrangler d1 migrations
      // apply` and works fine in prebuilt mode.
      throw new AlephaError(
        "Postgres migrations are not yet supported in prebuilt mode. Use the `alepha platform up` CLI for now.",
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
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<PlatformState> {
    this.configureApi(ctx);
    const state: PlatformState = {
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
            const deployment = await this.getActiveDeployment(name);
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
            const configs = await this.api.listHyperdrive();
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
            const databases = await this.api.listD1();
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
          const buckets = await this.api.listR2();
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
          const namespaces = await this.api.listKV();
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
      tasks.push({
        name: `inspect queue (${queueName})`,
        handler: async () => {
          const queues = await this.api.listQueues();
          const existing = queues.find((q) => q.queue_name === queueName);
          state.queues.push({
            name: queueName,
            exists: !!existing,
            id: existing?.queue_id,
          });
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
            const deployed = await this.api.listSecrets(workerName);
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

  async teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    this.configureApi(ctx);
    if (ctx.resources.hasQueue) {
      const workerName = ctx.naming.worker();
      const queueName = ctx.naming.queue();
      await run({
        name: `unbind queue consumer ${queueName}`,
        handler: async () => {
          try {
            const queues = await this.api.listQueues();
            const queue = queues.find((q) => q.queue_name === queueName);
            if (queue) {
              await this.api.deleteQueueConsumer(queue.queue_id, workerName);
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
            await this.api.deleteWorker(name);
          } catch (error: any) {
            this.log.warn(
              `Failed to delete worker ${name}: ${String(error.message || "")}`,
            );
          }
        },
      });
    }
    if (ctx.resources.hasQueue) {
      const name = ctx.naming.queue();
      await run({
        name: `delete queue ${name}`,
        handler: async () => {
          try {
            const queues = await this.api.listQueues();
            const queue = queues.find((q) => q.queue_name === name);
            if (!queue) {
              this.log.debug(`Queue ${name} not found — skipping.`);
              return;
            }
            await this.api.deleteQueue(queue.queue_id);
          } catch (error: any) {
            this.log.warn(
              `Failed to delete queue ${name}: ${String(error.message || "")}`,
            );
          }
        },
      });
    }
    if (ctx.resources.hasKV) {
      const name = ctx.naming.kv();
      await run({
        name: `delete kv ${name}`,
        handler: async () => {
          try {
            const namespaces = await this.api.listKV();
            const existing = namespaces.find((ns) => ns.title === name);
            if (!existing) {
              this.log.debug(`KV namespace ${name} not found — skipping.`);
              return;
            }
            await this.api.deleteKV(existing.id);
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
    // wipe is NOT a precondition of the delete — a wipe that can't run (no
    // creds) must never strand an otherwise-deletable bucket.
    const needsBucket = ctx.resources.hasBucket;
    if (needsBucket) {
      const name = ctx.naming.r2();
      await run({
        name: `delete r2 ${name}`,
        handler: async () => {
          try {
            await this.deleteR2Bucket(name, ctx);
          } catch (error: any) {
            const msg = String(error.message || "");
            if (this.isMissingBucketError(msg)) {
              this.log.debug(`Bucket ${name} not found — skipping.`);
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
              const configs = await this.api.listHyperdrive();
              const existing = configs.find((c) => c.name === name);
              if (!existing) {
                this.log.debug(`Hyperdrive ${name} not found — skipping.`);
                return;
              }
              await this.api.deleteHyperdrive(existing.id);
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
              const databases = await this.api.listD1();
              const existing = databases.find((db) => db.name === name);
              if (!existing) {
                this.log.debug(`D1 database ${name} not found — skipping.`);
                return;
              }
              await this.api.deleteD1(existing.uuid);
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

  protected async ensureD1(name: string): Promise<string> {
    const databases = await this.api.listD1();
    const existing = databases.find((db) => db.name === name);
    if (existing) {
      return existing.uuid;
    }

    const created = await this.api.createD1(name);
    return created.uuid;
  }

  protected async ensureHyperdrive(
    name: string,
    connectionString: string,
  ): Promise<string> {
    const configs = await this.api.listHyperdrive();
    const existing = configs.find((c) => c.name === name);
    if (existing) {
      return existing.id;
    }

    const created = await this.api.createHyperdrive(name, connectionString);
    return created.id;
  }

  protected async ensureR2(name: string): Promise<void> {
    const buckets = await this.api.listR2();
    const existing = buckets.find((b) => b.name === name);
    if (existing) {
      return;
    }

    await this.api.createR2(name);
  }

  /** Whether a Cloudflare error message indicates the bucket is already gone. */
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
   * (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) — these are already
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
   * common teardown case — no objects, no creds needed), and only on failure
   * empty the bucket over the S3 protocol and retry. A missing bucket is a
   * no-op, so teardown is idempotent.
   */
  protected async deleteR2Bucket(
    name: string,
    ctx: PlatformContext,
  ): Promise<void> {
    try {
      await this.api.deleteR2(name);
      return;
    } catch (error: any) {
      const msg = String(error.message || "");
      if (this.isMissingBucketError(msg)) {
        return; // already gone
      }
      // Most often the bucket is non-empty — empty it then retry once.
      this.log.debug(
        `Direct delete of r2 ${name} failed (${msg}); emptying then retrying.`,
      );
    }

    await this.wipeR2Bucket(name, ctx);

    try {
      await this.api.deleteR2(name);
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
   * Cloudflare's REST API has no object-level endpoints — objects must be
   * listed and deleted over the S3 protocol. We use the account's R2 S3
   * credentials (`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`) when present;
   * otherwise we fall back to minting a short-lived bucket-scoped token via
   * the CF API (requires a user-scoped `CLOUDFLARE_API_TOKEN`) and revoke it
   * after. When neither is available the wipe is skipped with a warning —
   * the caller still attempts the delete, which succeeds for empty buckets.
   *
   * Also aborts any pending multipart uploads — those count as bucket
   * contents from R2's perspective and would otherwise block the delete.
   */
  protected async wipeR2Bucket(
    bucketName: string,
    ctx: PlatformContext,
  ): Promise<void> {
    let creds = this.resolveR2Credentials();
    let mintedTokenId: string | undefined;

    if (!creds) {
      // No env S3 creds — try minting a bucket-scoped token. This needs a
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
        const token = await this.api.createR2Token(tokenName, bucketName);
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
      const accountId = await this.api.resolveAccountId();
      const jur = ctx.envConfig.jurisdiction;
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
      // Revoke only a token we minted here — env S3 creds are long-lived and
      // must not be deleted. Always revoke, even if the wipe failed mid-way.
      if (mintedTokenId) {
        try {
          await this.api.deleteR2Token(mintedTokenId);
        } catch (error: any) {
          this.log.warn(
            `Failed to revoke ephemeral R2 token ${mintedTokenId}: ${String(error.message || "")}`,
          );
        }
      }
    }
  }

  protected async ensureKV(name: string): Promise<string> {
    const namespaces = await this.api.listKV();
    const existing = namespaces.find((ns) => ns.title === name);
    if (existing) {
      return existing.id;
    }

    const created = await this.api.createKV(name);
    return created.id;
  }

  protected async ensureQueue(name: string): Promise<void> {
    const queues = await this.api.listQueues();
    const existing = queues.find((q) => q.queue_name === name);
    if (existing) {
      return;
    }

    await this.api.createQueue(name);
  }

  /**
   * Get the currently active deployment for a worker.
   */
  protected async getActiveDeployment(
    workerName: string,
  ): Promise<
    { versionId: string; tag?: string; createdAt?: string } | undefined
  > {
    const deployments = await this.api.listDeployments(workerName);

    // API ordering is not guaranteed across releases — sort explicitly.
    const sorted = [...deployments].sort((a, b) =>
      b.created_on.localeCompare(a.created_on),
    );
    const latest = sorted[0];
    if (!latest?.versions?.[0]) {
      return undefined;
    }

    const activeVersionId = latest.versions[0].version_id;

    const versions = await this.api.listVersions(workerName);
    const version = versions.find((v) => v.id === activeVersionId);

    return {
      versionId: activeVersionId,
      tag: version?.annotations?.["workers/tag"],
      createdAt: version?.metadata.created_on,
    };
  }
}

/**
 * Stable SHA-256 of the secret set. Keys are sorted so reordering `.env`
 * lines does not invalidate the cache. Used as a fingerprint by
 * `CloudflareAdapter.secrets` — see the comment block there.
 */
function computeSecretsHash(
  secrets: Record<string, string>,
  salt: string,
): string {
  const sorted = Object.keys(secrets)
    .sort()
    .map((k) => `${k}=${secrets[k]}`)
    .join("\n");
  // Salted + deliberately slow. A plain sha256 of "KEY=VALUE" lines stored in
  // a *readable* binding is an offline brute-force oracle: anyone with
  // worker-settings read access could recover low-entropy secret values,
  // which is precisely what Cloudflare's write-only secrets prevent. The salt
  // kills precomputation; the KDF cost makes guessing expensive. It stays
  // stable across deploys (the salt is stored alongside), so the skip-if-
  // unchanged cache still works.
  return scryptSync(sorted, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}

/**
 * Serialized fingerprint: `v2:<salt>:<digest>`. The v1 format was a bare
 * sha256 of the values; it is treated as a miss so the next deploy upgrades
 * it in place.
 */
function parseSecretsFingerprint(
  text: string | undefined,
): { salt: string; digest: string } | undefined {
  if (!text?.startsWith("v2:")) {
    return undefined;
  }
  const [, salt, digest] = text.split(":");
  return salt && digest ? { salt, digest } : undefined;
}
