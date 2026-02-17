import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import type { RunnerMethod } from "../../../command/helpers/Runner.ts";
import { AlephaCliUtils } from "../../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../../services/PackageManagerUtils.ts";
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

  protected provisionedD1Id?: string;
  protected uploadedVersions = new Map<string, string>();

  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  async authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    await run({
      name: "authenticate",
      handler: async () => {
        await this.pm.ensureDependency(ctx.root, "wrangler", {
          dev: true,
          exec: (cmd, opts) => this.utils.exec(cmd, opts),
        });

        if (await this.cache.isLoginFresh(ctx.root, "cloudflare")) {
          return;
        }

        const output = await this.shell.run("wrangler whoami", {
          resolve: true,
          capture: true,
        });

        if (output.includes("not authenticated")) {
          run.pause();
          await this.shell.run("wrangler login", { resolve: true });
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

    if (ctx.app.resources.hasDatabase && this.provisionedD1Id) {
      const dbName = ctx.naming.d1();
      env.DATABASE_URL = `d1://${dbName}:${this.provisionedD1Id}`;
    }

    if (ctx.app.resources.hasBucket) {
      env.R2_BUCKET_NAME = ctx.naming.r2();
    }

    await run({
      name: "alepha build -t cloudflare",
      handler: async () => {
        await this.shell.run("alepha build -t cloudflare", {
          root: appDir,
          capture: true,
          env,
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // push
  // -------------------------------------------------------------------------

  async push(ctx: AppContext, run: RunnerMethod): Promise<void> {
    const workerName = ctx.naming.worker(
      ctx.apps.length > 1 ? ctx.app.name : undefined,
    );
    const distDir = ctx.app.path
      ? this.fs.join(ctx.root, ctx.app.path, "dist")
      : this.fs.join(ctx.root, "dist");

    await run({
      name: `push ${ctx.app.name}`,
      handler: async () => {
        const output = await this.shell.run(
          `wrangler versions upload --name=${workerName} --no-bundle --tag=latest --config=${distDir}/wrangler.jsonc`,
          { resolve: true, capture: true },
        );

        const versionId = this.parseVersionId(output);
        if (versionId) {
          this.uploadedVersions.set(workerName, versionId);
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // activate
  // -------------------------------------------------------------------------

  async activate(ctx: AppContext, run: RunnerMethod): Promise<void> {
    const workerName = ctx.naming.worker(
      ctx.apps.length > 1 ? ctx.app.name : undefined,
    );

    await run({
      name: `activate ${ctx.app.name}`,
      handler: async () => {
        const versionId =
          this.uploadedVersions.get(workerName) ??
          (await this.getLatestVersionId(workerName));

        await this.shell.run(
          `wrangler versions deploy ${versionId}@100 --name=${workerName} --yes`,
          { resolve: true, capture: true },
        );
      },
    });
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

    if (needsDB) {
      const dbName = ctx.naming.d1();
      await run({
        name: `provision d1 (${dbName})`,
        handler: async () => {
          this.provisionedD1Id = await this.ensureD1(dbName);
        },
      });
    }

    if (needsBucket) {
      const bucketName = ctx.naming.r2();
      await run({
        name: `provision r2 (${bucketName})`,
        handler: async () => {
          await this.ensureR2(bucketName);
        },
      });
    }

    // KV -- per app
    for (const app of ctx.apps) {
      if (app.resources.hasKV) {
        const kvName = ctx.naming.kv(
          ctx.apps.length > 1 ? app.name : undefined,
        );
        await run({
          name: `provision kv (${kvName})`,
          handler: async () => {
            await this.ensureKV(kvName);
          },
        });
      }
    }

    // Queue -- per app
    for (const app of ctx.apps) {
      if (app.resources.hasQueue) {
        const queueName = ctx.naming.queue(
          ctx.apps.length > 1 ? app.name : undefined,
        );
        await run({
          name: `provision queue (${queueName})`,
          handler: async () => {
            await this.ensureQueue(queueName);
          },
        });
      }
    }
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

    const dbName = ctx.naming.d1();

    await run({
      name: "migrate",
      handler: async () => {
        const migrationsDir = this.fs.join(ctx.root, "migrations", "sqlite");
        const dbUrl = this.provisionedD1Id
          ? `d1://${dbName}:${this.provisionedD1Id}`
          : `d1://${dbName}`;
        const env = { DATABASE_URL: dbUrl };

        if (await this.fs.exists(migrationsDir)) {
          await this.shell.run("alepha db migrations check", {
            resolve: true,
            capture: true,
            env,
          });
        } else {
          await this.shell.run("alepha db migrations generate --mode toto", {
            resolve: true,
            capture: true,
            env,
          });
        }

        // Copy migrations to dist for wrangler, apply, then clean up
        const distMigrations = this.fs.join(ctx.root, "dist", "migrations");
        await this.fs.cp(migrationsDir, distMigrations);

        await this.shell.run(
          `wrangler d1 migrations apply ${dbName} --remote --config=dist/wrangler.jsonc`,
          { resolve: true, capture: true, env: { CI: "1" } },
        );

        await this.fs.rm(distMigrations, { recursive: true });
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

    // D1
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
    if (needsDB) {
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

    // R2
    const needsBucket = ctx.apps.some((a) => a.resources.hasBucket);
    if (needsBucket) {
      const bucketName = ctx.naming.r2();
      tasks.push({
        name: `inspect r2 (${bucketName})`,
        handler: async () => {
          const output = await this.shell.run("wrangler r2 bucket list", {
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

    await run(tasks);

    return state;
  }

  // -------------------------------------------------------------------------
  // teardown
  // -------------------------------------------------------------------------

  async teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    // Delete workers
    for (const app of ctx.apps) {
      const name = ctx.naming.worker(
        ctx.apps.length > 1 ? app.name : undefined,
      );
      await run({
        name: `delete worker ${name}`,
        handler: async () => {
          try {
            await this.shell.run(`wrangler delete --name=${name} --force`, {
              resolve: true,
              capture: true,
            });
          } catch {}
        },
      });
    }

    // Delete queues
    for (const app of ctx.apps) {
      if (app.resources.hasQueue) {
        const name = ctx.naming.queue(
          ctx.apps.length > 1 ? app.name : undefined,
        );
        await run({
          name: `delete queue ${name}`,
          handler: async () => {
            try {
              await this.shell.run(`wrangler queues delete ${name}`, {
                resolve: true,
                capture: true,
              });
            } catch {}
          },
        });
      }
    }

    // Delete KV
    for (const app of ctx.apps) {
      if (app.resources.hasKV) {
        const name = ctx.naming.kv(ctx.apps.length > 1 ? app.name : undefined);
        await run({
          name: `delete kv ${name}`,
          handler: async () => {
            try {
              await this.shell.run(
                `wrangler kv namespace delete --namespace-id=${name}`,
                { resolve: true, capture: true },
              );
            } catch {}
          },
        });
      }
    }

    // Delete R2 (only if no objects -- warn otherwise)
    const needsBucket = ctx.apps.some((a) => a.resources.hasBucket);
    if (needsBucket) {
      const name = ctx.naming.r2();
      const isTmp = ctx.env.startsWith("tmp");
      await run({
        name: `delete r2 ${name}`,
        handler: async () => {
          try {
            if (isTmp) {
              await this.shell.run(
                `wrangler r2 object delete ${name} --recursive`,
                { resolve: true, capture: true },
              );
            }
            await this.shell.run(`wrangler r2 bucket delete ${name}`, {
              resolve: true,
              capture: true,
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

    // Delete D1
    const needsDB = ctx.apps.some((a) => a.resources.hasDatabase);
    if (needsDB) {
      const name = ctx.naming.d1();
      await run({
        name: `delete d1 ${name}`,
        handler: async () => {
          try {
            await this.shell.run(`wrangler d1 delete ${name} -y`, {
              resolve: true,
              capture: true,
            });
          } catch {}
        },
      });
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

    const output = await this.shell.run(`wrangler d1 create ${name}`, {
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
    const output = await this.shell.run("wrangler d1 list --json", {
      resolve: true,
      capture: true,
    });
    return JSON.parse(output) as Array<{ name: string; uuid: string }>;
  }

  protected async ensureR2(name: string): Promise<void> {
    try {
      await this.shell.run(`wrangler r2 bucket create ${name}`, {
        resolve: true,
        capture: true,
      });
    } catch (error: any) {
      const msg = String(error.stderr || error.message || "");
      if (!msg.includes("already exists")) {
        throw error;
      }
    }
  }

  protected async ensureKV(name: string): Promise<void> {
    try {
      await this.shell.run(`wrangler kv namespace create ${name}`, {
        resolve: true,
        capture: true,
      });
    } catch (error: any) {
      const msg = String(error.stderr || error.message || "");
      if (!msg.includes("already exists")) {
        throw error;
      }
    }
  }

  protected async ensureQueue(name: string): Promise<void> {
    try {
      await this.shell.run(`wrangler queues create ${name}`, {
        resolve: true,
        capture: true,
      });
    } catch (error: any) {
      const msg = String(error.stderr || error.message || "");
      if (!msg.includes("already exists")) {
        throw error;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Version helpers
  // -------------------------------------------------------------------------

  /**
   * Parse version ID (UUID) from `wrangler versions upload` output.
   */
  protected parseVersionId(output: string): string | undefined {
    const match = output.match(
      /(?:Worker Version ID|Version ID|Uploaded).*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    return match?.[1];
  }

  /**
   * Get the latest uploaded version ID for a worker via `wrangler versions list`.
   */
  protected async getLatestVersionId(workerName: string): Promise<string> {
    const output = await this.shell.run(
      `wrangler versions list --name=${workerName} --json`,
      { resolve: true, capture: true },
    );

    const versions = JSON.parse(output) as Array<{ id: string }>;
    const latest = versions.at(-1);
    if (!latest?.id) {
      throw new AlephaError(
        `No versions found for worker '${workerName}'. Run push first.`,
      );
    }

    return latest.id;
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
    const output = await this.shell.run(
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
    const versionsOutput = await this.shell.run(
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
