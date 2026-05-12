import { $inject, Alepha, AlephaError } from "alepha";
import { EnvUtils, Runner, type RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { PlatformCacheProvider } from "../providers/PlatformCacheProvider.ts";
import { CloudflareApi } from "../services/CloudflareApi.ts";
import { WranglerApi } from "../services/WranglerApi.ts";
import {
  type AppContext,
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
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly api = $inject(CloudflareApi);
  protected readonly wrangler = $inject(WranglerApi);
  protected readonly runner = $inject(Runner);

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
    const capture = options.capture;
    const output = await this.shell.run(command, {
      ...options,
      capture: capture ?? this.runner.useDynamicLogger,
    });

    if (capture && !this.runner.useDynamicLogger) {
      this.log.info(output);
    }

    return output;
  }

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  async authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    this.configureApi(ctx);
    await run({
      name: "authenticate",
      handler: async () => {
        await this.wrangler.ensureInstalled(ctx.root, run);

        // Always validate the token — refresh tokens can expire between runs
        // even when the cache TTL hasn't elapsed.
        let needsLogin = false;

        try {
          await this.wrangler.getAuthToken();
        } catch {
          needsLogin = true;
        }

        if (needsLogin) {
          run.pause();
          await this.wrangler.login();
          run.resume();
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

  async build(ctx: AppContext, run: RunnerMethod): Promise<void> {
    this.configureApi(ctx);
    const appDir = ctx.app.path
      ? this.fs.join(ctx.root, ctx.app.path)
      : ctx.root;

    const env: Record<string, string> = {};

    if (ctx.app.resources.hasDatabase) {
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

    if (ctx.app.resources.hasBucket) {
      env.R2_BUCKET_NAME = ctx.naming.r2();
    }

    if (ctx.app.resources.hasKV) {
      const kvName = ctx.naming.kv(
        ctx.apps.length > 1 ? ctx.app.name : undefined,
      );
      env.CLOUDFLARE_KV_NAME = kvName;
      const kvId = this.provisionedKVIds.get(kvName);
      if (kvId) {
        env.CLOUDFLARE_KV_ID = kvId;
      }
    }

    if (ctx.app.resources.hasQueue) {
      env.CLOUDFLARE_QUEUE_NAME = ctx.naming.queue(
        ctx.apps.length > 1 ? ctx.app.name : undefined,
      );
    }

    if (ctx.envConfig.domain) {
      if (ctx.envConfig.domain.includes("*") && !ctx.envConfig.zone) {
        throw new AlephaError(
          `Wildcard domain "${ctx.envConfig.domain}" requires "zone" to be set in the environment config (the Cloudflare zone name, e.g. "alepha.dev").`,
        );
      }
      env.CLOUDFLARE_DOMAIN = ctx.envConfig.domain;
      if (ctx.envConfig.zone) {
        env.CLOUDFLARE_ZONE = ctx.envConfig.zone;
      }
    }

    if (ctx.envConfig.jurisdiction) {
      env.CLOUDFLARE_JURISDICTION = ctx.envConfig.jurisdiction;
    }

    await run({
      name: "alepha build -t cloudflare",
      handler: async () => {
        await this.runShell("alepha build -t cloudflare", {
          root: appDir,
          env,
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // deploy (wrangler — handles bundling/upload)
  // -------------------------------------------------------------------------

  async deploy(
    ctx: AppContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    this.configureApi(ctx);
    const workerName = ctx.naming.worker(
      ctx.apps.length > 1 ? ctx.app.name : undefined,
    );
    const distDir = ctx.app.path
      ? this.fs.join(ctx.root, ctx.app.path, "dist")
      : this.fs.join(ctx.root, "dist");

    let url: string | undefined;

    await run({
      name: `deploy worker ${ctx.app.name}`,
      handler: async () => {
        url = await this.wrangler.deploy(
          workerName,
          `${distDir}/wrangler.jsonc`,
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
  ]);

  override async secrets(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    this.configureApi(ctx);
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);

    // Filter out binding/build vars, VITE_* vars, and empty values
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(envVars)) {
      if (!value) continue;
      if (CloudflareAdapter.EXCLUDED_SECRET_KEYS.has(key)) continue;
      if (key.startsWith("VITE_")) continue;
      secrets[key] = value;
    }

    if (Object.keys(secrets).length === 0) {
      return;
    }

    // Push all secrets for a worker in a single PATCH so each `up` only
    // mints one new deployment for the secrets step (regardless of how many
    // are being updated). Loop-based `putSecret` worked but generated N
    // deployment rows per push, cluttering the CF dashboard.
    //
    // Implementation mirrors `wrangler secret bulk`:
    //   1. GET current worker bindings via `/script/{name}/settings`.
    //   2. Keep all non-secret bindings as-is (D1, R2, KV, etc. — these
    //      were set by `wrangler deploy` and would be wiped by a bare
    //      PATCH).
    //   3. Keep any secret bindings we are NOT overwriting (forwarded as
    //      `{type,name}` only — CF preserves the stored value).
    //   4. Add/overwrite the secrets we want with `{type,name,text}`.
    //   5. PATCH the merged binding list in one call.
    for (const app of ctx.apps) {
      const workerName = ctx.naming.worker(
        ctx.apps.length > 1 ? app.name : undefined,
      );

      await run({
        name: `push secrets to ${workerName} (bulk)`,
        handler: async () => {
          const settings = await this.api.getWorkerSettings(workerName);
          const overwriting = new Set(Object.keys(secrets));
          const inherit = (settings.bindings ?? [])
            .filter((b) => b.type !== "secret_text" || !overwriting.has(b.name))
            .map((b) => ({ type: b.type, name: b.name }));
          const upsert = Object.entries(secrets).map(([name, text]) => ({
            type: "secret_text" as const,
            name,
            text,
          }));
          await this.api.patchWorkerBindings(workerName, [
            ...inherit,
            ...upsert,
          ]);
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // provision (REST API)
  // -------------------------------------------------------------------------

  override async provision(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    this.configureApi(ctx);
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
    const needsBucket = ctx.apps.some((a) => a.resources.hasBucket);
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

    for (const app of ctx.apps) {
      if (app.resources.hasKV) {
        const kvName = ctx.naming.kv(
          ctx.apps.length > 1 ? app.name : undefined,
        );
        tasks.push({
          name: `provision kv (${kvName})`,
          handler: async () => {
            this.provisionedKVIds.set(kvName, await this.ensureKV(kvName));
          },
        });
      }

      if (app.resources.hasQueue) {
        const queueName = ctx.naming.queue(
          ctx.apps.length > 1 ? app.name : undefined,
        );
        tasks.push({
          name: `provision queue (${queueName})`,
          handler: async () => {
            await this.ensureQueue(queueName);
          },
        });
      }
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
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
    if (!needsDB) {
      return;
    }

    if (await this.isPostgres(ctx)) {
      await this.migratePostgres(ctx, run);
    } else {
      await this.migrateD1(ctx, run);
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

        if (await this.fs.exists(migrationsDir)) {
          await this.runShell(`alepha db migrations check --mode ${ctx.env}`, {
            resolve: true,
            env,
          });
        } else {
          await this.runShell(`alepha db migrations create --mode ${ctx.env}`, {
            resolve: true,
            env,
          });
        }

        // Copy migrations to dist for wrangler, apply, then clean up
        const distMigrations = this.fs.join(ctx.root, "dist", "migrations");
        await this.fs.cp(migrationsDir, distMigrations);

        await this.wrangler.d1MigrationsApply(dbName, "dist/wrangler.jsonc");

        await this.fs.rm(distMigrations, { recursive: true });
      },
    });
  }

  protected async migratePostgres(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
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
    for (const app of ctx.apps) {
      const name = ctx.naming.worker(
        ctx.apps.length > 1 ? app.name : undefined,
      );

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
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
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
    const needsBucket = ctx.apps.some((a) => a.resources.hasBucket);
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

    // KV
    for (const app of ctx.apps) {
      if (app.resources.hasKV) {
        const kvName = ctx.naming.kv(
          ctx.apps.length > 1 ? app.name : undefined,
        );
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
    }

    // Queues
    for (const app of ctx.apps) {
      if (app.resources.hasQueue) {
        const queueName = ctx.naming.queue(
          ctx.apps.length > 1 ? app.name : undefined,
        );
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
      const workerName = ctx.naming.worker(
        ctx.apps.length > 1 ? ctx.apps[0].name : undefined,
      );
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
    // 1. Remove queue consumers (must happen before worker or queue deletion)
    for (const app of ctx.apps) {
      if (app.resources.hasQueue) {
        const workerName = ctx.naming.worker(
          ctx.apps.length > 1 ? app.name : undefined,
        );
        const queueName = ctx.naming.queue(
          ctx.apps.length > 1 ? app.name : undefined,
        );
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
    }

    // 2. Delete workers
    for (const app of ctx.apps) {
      const name = ctx.naming.worker(
        ctx.apps.length > 1 ? app.name : undefined,
      );
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

    // 3. Delete queues (after worker is gone)
    for (const app of ctx.apps) {
      if (app.resources.hasQueue) {
        const name = ctx.naming.queue(
          ctx.apps.length > 1 ? app.name : undefined,
        );
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
    }

    // 4. Delete KV namespaces
    for (const app of ctx.apps) {
      if (app.resources.hasKV) {
        const name = ctx.naming.kv(ctx.apps.length > 1 ? app.name : undefined);
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
    }

    // 5. Delete R2 bucket
    // TODO: empty bucket via S3-compatible API before deletion (needs native S3 client)
    // const needsBucket = ctx.apps.some((a) => a.resources.hasBucket);
    // if (needsBucket) {
    //   const name = ctx.naming.r2();
    //   await run({
    //     name: `delete r2 ${name}`,
    //     handler: async () => {
    //       try {
    //         await this.api.deleteR2(name);
    //       } catch (error: any) {
    //         const msg = String(error.message || "");
    //         if (
    //           msg.includes("does not exist") ||
    //           msg.includes("NoSuchBucket")
    //         ) {
    //           // Already gone, nothing to do
    //         } else if (
    //           msg.includes("not empty") ||
    //           msg.includes("BucketNotEmpty")
    //         ) {
    //           this.log.warn(
    //             `Bucket ${name} is not empty -- skipped. Empty it manually.`,
    //           );
    //         } else {
    //           this.log.warn(`Failed to delete r2 ${name}: ${msg}`);
    //         }
    //       }
    //     },
    //   });
    // }

    // 6. Delete D1 or Hyperdrive
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
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
