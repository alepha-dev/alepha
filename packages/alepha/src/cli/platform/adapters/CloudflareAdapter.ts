import { $inject, Alepha, AlephaError } from "alepha";
import { AlephaCliUtils, PackageManagerUtils } from "alepha/cli";
import { EnvUtils, Runner, type RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { PlatformCacheProvider } from "../providers/PlatformCacheProvider.ts";
import {
  type AppContext,
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Cloudflare Workers adapter.
 *
 * Manages workers, D1, R2, KV, and queues via the wrangler CLI.
 */
export class CloudflareAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly cache = $inject(PlatformCacheProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly runner = $inject(Runner);
  protected readonly envUtils = $inject(EnvUtils);

  protected provisionedD1Id?: string;
  protected provisionedHyperdriveId?: string;
  protected provisionedKVId?: string;

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
    await run({
      name: "authenticate",
      handler: async () => {
        await this.pm.ensureDependency(ctx.root, "wrangler", {
          dev: true,
          exec: async (cmd, opts) => {
            run.pause();
            try {
              await this.utils.exec(cmd, opts);
            } finally {
              run.resume();
            }
          },
        });

        if (await this.cache.isLoginFresh(ctx.root, "cloudflare")) {
          return;
        }

        const output = await this.runShell("wrangler whoami", {
          resolve: true,
          capture: true,
        });

        if (output.includes("not authenticated")) {
          run.pause();
          await this.runShell("wrangler login", { resolve: true });
          run.resume();
        }

        // Extract account ID if possible
        const match = output.match(/(\w{32})/);

        await this.cache.recordLogin(ctx.root, "cloudflare", match?.[1]);
      },
    });
  }

  // -------------------------------------------------------------------------
  // build
  // -------------------------------------------------------------------------

  async build(ctx: AppContext, run: RunnerMethod): Promise<void> {
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
      env.CLOUDFLARE_KV_NAME = ctx.naming.kv(
        ctx.apps.length > 1 ? ctx.app.name : undefined,
      );
      if (this.provisionedKVId) {
        env.CLOUDFLARE_KV_ID = this.provisionedKVId;
      }
    }

    if (ctx.app.resources.hasQueue) {
      env.CLOUDFLARE_QUEUE_NAME = ctx.naming.queue(
        ctx.apps.length > 1 ? ctx.app.name : undefined,
      );
    }

    if (ctx.envConfig.domain) {
      env.CLOUDFLARE_DOMAIN = ctx.envConfig.domain;
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
  // deploy
  // -------------------------------------------------------------------------

  async deploy(
    ctx: AppContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
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
        const output = await this.runShell(
          `wrangler deploy --name=${workerName} --no-bundle --config=${distDir}/wrangler.jsonc`,
          { resolve: true, capture: true },
        );

        const match = output.match(/https:\/\/[^\s]*\.workers\.dev/);
        if (match) {
          url = match[0];
        }
      },
    });

    return url;
  }

  // -------------------------------------------------------------------------
  // secrets
  // -------------------------------------------------------------------------

  /**
   * Vars that are handled by wrangler bindings or build config.
   * These should not be pushed as secrets.
   */
  static readonly EXCLUDED_SECRET_KEYS = new Set([
    "DATABASE_URL",
    "R2_BUCKET_NAME",
    "CLOUDFLARE_DOMAIN",
    "HYPERDRIVE_ID",
    "POSTGRES_SCHEMA",
    "NODE_ENV",
  ]);

  override async secrets(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
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

    // Push secrets to each worker
    for (const app of ctx.apps) {
      const workerName = ctx.naming.worker(
        ctx.apps.length > 1 ? app.name : undefined,
      );

      await run({
        name: `push secrets to ${workerName}`,
        handler: async () => {
          const secretsPath = await this.utils.writeConfigFile(
            "secrets.json",
            JSON.stringify(secrets),
            ctx.root,
          );

          await this.runShell(
            `wrangler secret bulk ${secretsPath} --name=${workerName}`,
            { resolve: true },
          );
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // provision
  // -------------------------------------------------------------------------

  override async provision(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
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
            this.provisionedKVId = await this.ensureKV(kvName);
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
  // migrate
  // -------------------------------------------------------------------------

  override async migrate(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
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
          await this.runShell("alepha db migrations check", {
            resolve: true,
            env,
          });
        } else {
          await this.runShell("alepha db migrations generate", {
            resolve: true,
            env,
          });
        }

        // Copy migrations to dist for wrangler, apply, then clean up
        const distMigrations = this.fs.join(ctx.root, "dist", "migrations");
        await this.fs.cp(migrationsDir, distMigrations);

        await this.runShell(
          `wrangler d1 migrations apply ${dbName} --remote --config=dist/wrangler.jsonc`,
          { resolve: true, env: { CI: "1" } },
        );

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
        const migrationsDir = this.fs.join(ctx.root, "migrations", "postgres");
        const env = { DATABASE_URL: process.env.DATABASE_URL! };

        if (await this.fs.exists(migrationsDir)) {
          await this.runShell("alepha db migrations check", {
            resolve: true,
            env,
          });
        } else {
          await this.runShell("alepha db migrations generate", {
            resolve: true,
            env,
          });
        }

        await this.runShell("alepha db migrations apply", {
          resolve: true,
          env,
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // inspect
  // -------------------------------------------------------------------------

  async inspect(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<PlatformState> {
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
            const configs = await this.listHyperdrive();
            const existing = configs.find((c) => c.name === hdName);
            state.databases.push({
              name: hdName,
              exists: !!existing,
              id: existing?.id,
            });
          },
        });
      } else {
        const dbName = ctx.naming.d1();
        tasks.push({
          name: `inspect d1 (${dbName})`,
          handler: async () => {
            const databases = await this.listD1();
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
          const output = await this.runShell("wrangler r2 bucket list", {
            resolve: true,
            capture: true,
          });
          state.buckets.push({
            name: bucketName,
            exists: output.includes(bucketName),
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
      const workerName = ctx.naming.worker(
        ctx.apps.length > 1 ? ctx.apps[0].name : undefined,
      );
      tasks.push({
        name: "inspect secrets",
        handler: async () => {
          try {
            const output = await this.runShell(
              `wrangler secret list --name=${workerName} --format=json`,
              { resolve: true, capture: true },
            );
            const deployed = JSON.parse(output) as Array<{ name: string }>;
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
  // teardown
  // -------------------------------------------------------------------------

  async teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    // 1. Remove queue consumers from workers (must happen before worker or queue deletion)
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
              await this.runShell(
                `wrangler queues consumer remove ${queueName} ${workerName}`,
                { resolve: true },
              );
            } catch (error: any) {
              this.log.warn(
                `Failed to unbind queue consumer: ${String(error.stderr || error.message || "")}`,
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
            await this.runShell(`wrangler delete --name=${name} --force`, {
              resolve: true,
            });
          } catch (error: any) {
            this.log.warn(
              `Failed to delete worker ${name}: ${String(error.stderr || error.message || "")}`,
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
              await this.runShell(`wrangler queues delete ${name}`, {
                resolve: true,
              });
            } catch (error: any) {
              this.log.warn(
                `Failed to delete queue ${name}: ${String(error.stderr || error.message || "")}`,
              );
            }
          },
        });
      }
    }

    // 4. Delete KV (lookup namespace ID by title first)
    for (const app of ctx.apps) {
      if (app.resources.hasKV) {
        const name = ctx.naming.kv(ctx.apps.length > 1 ? app.name : undefined);
        await run({
          name: `delete kv ${name}`,
          handler: async () => {
            const namespaces = await this.listKV();
            const existing = namespaces.find((ns) => ns.title === name);
            if (!existing) {
              this.log.debug(`KV namespace ${name} not found — skipping.`);
              return;
            }
            try {
              await this.runShell(
                `wrangler kv namespace delete --namespace-id=${existing.id}`,
                { resolve: true },
              );
            } catch (error: any) {
              this.log.warn(
                `Failed to delete kv ${name}: ${String(error.stderr || error.message || "")}`,
              );
            }
          },
        });
      }
    }

    // 5. Delete R2 (only if no objects -- warn otherwise)
    const needsBucket = ctx.apps.some((a) => a.resources.hasBucket);
    if (needsBucket) {
      const name = ctx.naming.r2();
      const isTmp = ctx.env.startsWith("tmp");
      await run({
        name: `delete r2 ${name}`,
        handler: async () => {
          try {
            if (isTmp) {
              await this.runShell(
                `wrangler r2 object delete ${name} --recursive`,
                { resolve: true },
              );
            }
            await this.runShell(`wrangler r2 bucket delete ${name}`, {
              resolve: true,
            });
          } catch (error: any) {
            const msg = String(error.stderr || error.message || "");
            if (msg.includes("not empty")) {
              this.log.warn(
                `Bucket ${name} is not empty -- skipped. Empty it manually.`,
              );
            }
          }
        },
      });
    }

    // 6. Delete D1 or Hyperdrive
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
    if (needsDB) {
      if (await this.isPostgres(ctx)) {
        const name = ctx.naming.hyperdrive();
        await run({
          name: `delete hyperdrive ${name}`,
          handler: async () => {
            const configs = await this.listHyperdrive();
            const existing = configs.find((c) => c.name === name);
            if (!existing) {
              this.log.debug(`Hyperdrive ${name} not found — skipping.`);
              return;
            }
            try {
              await this.runShell(`wrangler hyperdrive delete ${existing.id}`, {
                resolve: true,
              });
            } catch (error: any) {
              this.log.warn(
                `Failed to delete hyperdrive ${name}: ${String(error.stderr || error.message || "")}`,
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
              await this.runShell(`wrangler d1 delete ${name} -y`, {
                resolve: true,
              });
            } catch (error: any) {
              this.log.warn(
                `Failed to delete d1 ${name}: ${String(error.stderr || error.message || "")}`,
              );
            }
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Wrangler helpers
  // -------------------------------------------------------------------------

  protected async ensureD1(name: string): Promise<string> {
    const databases = await this.listD1();
    const existing = databases.find((db) => db.name === name);
    if (existing) {
      return existing.uuid;
    }

    const output = await this.runShell(`wrangler d1 create ${name}`, {
      resolve: true,
      capture: true,
    });

    const match = output.match(/"database_id":\s*"([^"]+)"/);
    if (!match) {
      throw new AlephaError(
        `Failed to parse D1 database ID from wrangler output:\n${output}`,
      );
    }

    return match[1];
  }

  protected async listD1(): Promise<Array<{ name: string; uuid: string }>> {
    const output = await this.runShell("wrangler d1 list --json", {
      resolve: true,
      capture: true,
    });
    return JSON.parse(output) as Array<{ name: string; uuid: string }>;
  }

  protected async ensureHyperdrive(
    name: string,
    connectionString: string,
  ): Promise<string> {
    const configs = await this.listHyperdrive();
    const existing = configs.find((c) => c.name === name);
    if (existing) {
      return existing.id;
    }

    const output = await this.runShell(
      `wrangler hyperdrive create ${name} --connection-string="${connectionString}"`,
      { resolve: true, capture: true },
    );

    const match = output.match(
      /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    if (!match) {
      throw new AlephaError(
        `Failed to parse Hyperdrive config ID from wrangler output:\n${output}`,
      );
    }

    return match[1];
  }

  protected async listHyperdrive(): Promise<
    Array<{ id: string; name: string }>
  > {
    const output = await this.runShell("wrangler hyperdrive list", {
      resolve: true,
      capture: true,
    });

    // Parse table output — columns separated by │
    // Format: │ <id> │ <name> │ ...
    const configs: Array<{ id: string; name: string }> = [];
    const lines = output.split("\n");
    for (const line of lines) {
      const cells = line.split("│").map((c) => c.trim());
      if (cells.length < 3) continue;
      const id = cells[1];
      const name = cells[2];
      if (id && name && /^[0-9a-f]{32}$/i.test(id)) {
        configs.push({ id, name });
      }
    }

    return configs;
  }

  protected async listKV(): Promise<Array<{ id: string; title: string }>> {
    const output = await this.runShell("wrangler kv namespace list", {
      resolve: true,
      capture: true,
    });
    return JSON.parse(output) as Array<{ id: string; title: string }>;
  }

  protected async ensureR2(name: string): Promise<void> {
    try {
      await this.runShell(`wrangler r2 bucket create ${name}`, {
        resolve: true,
      });
    } catch (error: any) {
      const msg = String(error.stderr || error.message || "");
      if (!msg.includes("already exists")) {
        throw error;
      }
    }
  }

  protected async ensureKV(name: string): Promise<string> {
    const namespaces = await this.listKV();
    const existing = namespaces.find((ns) => ns.title === name);
    if (existing) {
      return existing.id;
    }

    const output = await this.runShell(`wrangler kv namespace create ${name}`, {
      resolve: true,
      capture: true,
    });

    const match = output.match(/"id"\s*:\s*"([0-9a-f]{32})"/i);
    if (!match) {
      throw new AlephaError(
        `Failed to parse KV namespace ID from wrangler output:\n${output}`,
      );
    }

    return match[1];
  }

  protected async ensureQueue(name: string): Promise<void> {
    try {
      await this.runShell(`wrangler queues create ${name}`, {
        resolve: true,
      });
    } catch (error: any) {
      const msg = String(error.stderr || error.message || "");
      if (!msg.includes("already exists") && !msg.includes("already taken")) {
        throw error;
      }
    }
  }

  /**
   * Get the currently active deployment for a worker.
   *
   * Uses `wrangler deployments list` to find the active version,
   * then fetches version details (tag, created date).
   */
  protected async getActiveDeployment(
    workerName: string,
  ): Promise<
    { versionId: string; tag?: string; createdAt?: string } | undefined
  > {
    const output = await this.runShell(
      `wrangler deployments list --name=${workerName} --json`,
      { resolve: true, capture: true },
    );

    const deployments = JSON.parse(output) as Array<{
      versions: Array<{ version_id: string; percentage: number }>;
      created_on?: string;
    }>;

    const latest = deployments.at(-1);
    if (!latest?.versions?.[0]) {
      return undefined;
    }

    const activeVersionId = latest.versions[0].version_id;

    // Look up the version to get tag/metadata
    const versionsOutput = await this.runShell(
      `wrangler versions list --name=${workerName} --json`,
      { resolve: true, capture: true },
    );

    const versions = JSON.parse(versionsOutput) as Array<{
      id: string;
      metadata: { created_on: string };
      annotations?: Record<string, string>;
    }>;

    const version = versions.find((v) => v.id === activeVersionId);

    return {
      versionId: activeVersionId,
      tag: version?.annotations?.["workers/tag"],
      createdAt: version?.metadata.created_on,
    };
  }
}
