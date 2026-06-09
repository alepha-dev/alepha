import { $inject, Alepha } from "alepha";
import { AlephaCliUtils } from "alepha/cli";
import { EnvUtils, type RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { PlatformCacheProvider } from "../providers/PlatformCacheProvider.ts";
import { VercelApi } from "../services/VercelApi.ts";
import { VercelCli } from "../services/VercelCli.ts";
import {
  type AppContext,
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Vercel platform adapter.
 *
 * Uses the Vercel CLI for login and deploy (--prebuilt),
 * and the Vercel REST API for project management, env vars, and inspection.
 *
 * v1 scope: deploy pipeline only. No DB/storage/KV provisioning.
 */
export class VercelAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly cache = $inject(PlatformCacheProvider);
  protected readonly alepha = $inject(Alepha);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly api = $inject(VercelApi);
  protected readonly vercelCli = $inject(VercelCli);

  /**
   * Vars that should not be pushed as env vars.
   * These are either handled by the build or are internal.
   */
  static readonly EXCLUDED_SECRET_KEYS = new Set(["NODE_ENV"]);

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

  async authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    await run({
      name: "authenticate",
      handler: async () => {
        await this.vercelCli.ensureInstalled(ctx.root);

        let needsLogin = false;

        try {
          await this.vercelCli.getAuthToken();
          await this.vercelCli.whoami();
        } catch {
          needsLogin = true;
        }

        if (needsLogin) {
          await this.vercelCli.login();
        }

        if (await this.cache.isLoginFresh(ctx.root, "vercel")) {
          return;
        }

        await this.cache.recordLogin(ctx.root, "vercel");
      },
    });
  }

  // -------------------------------------------------------------------------
  // build
  // -------------------------------------------------------------------------

  async build(ctx: AppContext, run: RunnerMethod): Promise<void> {
    const appDir = ctx.root;

    await run({
      name: "alepha build -t vercel",
      handler: async () => {
        await this.runShell("alepha build -t vercel", {
          root: appDir,
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
    const distDir = this.fs.join(ctx.root, "dist");

    const projectName = ctx.naming.worker();

    let url: string | undefined;

    await run({
      name: `deploy ${ctx.project}`,
      handler: async () => {
        // Ensure project exists and has framework: null for prebuilt deploys
        let project = await this.api.getProject(projectName);
        if (!project) {
          project = await this.api.createProject(projectName);
        }
        await this.api.updateProject(projectName, { framework: null });

        // Write project.json so vercel CLI knows which project to deploy to
        const vercelDir = this.fs.join(distDir, ".vercel");
        await this.fs.mkdir(vercelDir);
        await this.fs.writeFile(
          this.fs.join(vercelDir, "project.json"),
          JSON.stringify(
            {
              projectId: project.id,
              orgId: project.accountId,
            },
            null,
            2,
          ),
        );

        // Use env token for deploy if available (CI)
        const token = process.env.VERCEL_TOKEN;

        await this.vercelCli.deploy(distDir, {
          prod: true,
          token,
        });

        // Resolve production URL from latest deployment alias
        const deployments = await this.api.listDeployments(project.id, {
          limit: 1,
          target: "production",
        });
        const latest = deployments[0];
        url = latest?.alias?.[0]
          ? `https://${latest.alias[0]}`
          : `https://${projectName}.vercel.app`;
      },
    });

    return url;
  }

  // -------------------------------------------------------------------------
  // secrets
  // -------------------------------------------------------------------------

  override async secrets(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<void> {
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);

    const vars: Array<{ key: string; value: string; target: string[] }> = [];
    for (const [key, value] of Object.entries(envVars)) {
      if (!value) continue;
      if (VercelAdapter.EXCLUDED_SECRET_KEYS.has(key)) continue;
      if (key.startsWith("VITE_")) continue;
      vars.push({
        key,
        value,
        target: ["production", "preview"],
      });
    }

    if (vars.length === 0) {
      return;
    }

    {
      const projectName = ctx.naming.worker();

      await run({
        name: `push env vars to ${projectName}`,
        handler: async () => {
          await this.api.upsertEnvVars(projectName, vars);
        },
      });
    }
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

    // Projects/deployments (mapped to "workers" in PlatformState)
    {
      const projectName = ctx.naming.worker();

      tasks.push({
        name: `inspect project (${projectName})`,
        handler: async () => {
          const project = await this.api.getProject(projectName);
          if (!project) {
            state.workers.push({ name: projectName, exists: false });
            return;
          }

          const deployments = await this.api.listDeployments(project.id, {
            limit: 1,
          });
          const latest = deployments[0];

          state.workers.push({
            name: projectName,
            exists: true,
            version: latest?.uid,
            createdAt: latest?.created
              ? new Date(latest.created).toISOString()
              : undefined,
          });
        },
      });
    }

    // Env vars (mapped to "secrets")
    const envVars = await this.envUtils.parseEnv(ctx.root, [`.env.${ctx.env}`]);
    const expectedVars = Object.keys(envVars).filter(
      (key) =>
        envVars[key] &&
        !VercelAdapter.EXCLUDED_SECRET_KEYS.has(key) &&
        !key.startsWith("VITE_"),
    );

    if (expectedVars.length > 0) {
      const projectName = ctx.naming.worker();

      tasks.push({
        name: "inspect env vars",
        handler: async () => {
          try {
            const deployed = await this.api.listEnvVars(projectName);
            const deployedKeys = new Set(deployed.map((v) => v.key));
            for (const key of expectedVars) {
              state.secrets.push({
                name: key,
                deployed: deployedKeys.has(key),
              });
            }
          } catch {
            for (const key of expectedVars) {
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
    {
      const projectName = ctx.naming.worker();

      await run({
        name: `delete project ${projectName}`,
        handler: async () => {
          try {
            await this.api.deleteProject(projectName);
          } catch (error: any) {
            this.log.warn(
              `Failed to delete project ${projectName}: ${String(error.message || "")}`,
            );
          }
        },
      });
    }
  }
}
