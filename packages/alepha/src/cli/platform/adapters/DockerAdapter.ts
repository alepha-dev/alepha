import { dirname } from "node:path";
import { $inject } from "alepha";
import { EnvUtils, type RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { DockerComposeGenerator } from "../services/DockerComposeGenerator.ts";
import { DockerSshService } from "../services/DockerSshService.ts";
import {
  type AppContext,
  PlatformAdapter,
  type PlatformContext,
  type PlatformState,
} from "./PlatformAdapter.ts";

/**
 * Docker platform adapter.
 *
 * Handles both local development (docker compose for services)
 * and remote VPS deployment (SSH + Docker).
 *
 * Mode is determined by the `ip` field in environment config:
 * - No `ip`: local mode — compose up services (Postgres, Redis)
 * - With `ip`: remote mode — SSH to VPS, push dist, compose up
 *
 * Traefik is a shared singleton per VPS at /opt/alepha/traefik/.
 * Auto-provisioned on first deploy with `domain`, skipped if already running.
 */
export class DockerAdapter extends PlatformAdapter {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly generator = $inject(DockerComposeGenerator);
  protected readonly ssh = $inject(DockerSshService);

  protected readonly TRAEFIK_PATH = "/opt/alepha/traefik";
  protected readonly TRAEFIK_CONTAINER = "alepha-traefik";

  protected isRemote(ctx: PlatformContext): boolean {
    return !!ctx.envConfig.ip;
  }

  protected composePath(ctx: PlatformContext): string {
    return this.fs.join(ctx.root, "node_modules/.alepha/docker-compose.yml");
  }

  protected remotePath(ctx: PlatformContext): string {
    return `/opt/alepha/${ctx.project}-${ctx.env}`;
  }

  // ---------------------------------------------------------------------------
  // authenticate
  // ---------------------------------------------------------------------------

  async authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    await run({
      name: "authenticate",
      handler: async () => {
        await this.shell.run("docker --version");

        if (this.isRemote(ctx)) {
          await this.ssh.checkConnection(ctx.envConfig.ip!);
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // build
  // ---------------------------------------------------------------------------

  async build(ctx: AppContext, run: RunnerMethod): Promise<void> {
    if (!this.isRemote(ctx)) {
      return;
    }

    const appDir = ctx.app.path
      ? this.fs.join(ctx.root, ctx.app.path)
      : ctx.root;

    await run("alepha build -t docker", {
      root: appDir,
    });
  }

  // ---------------------------------------------------------------------------
  // deploy
  // ---------------------------------------------------------------------------

  async deploy(
    ctx: AppContext,
    run: RunnerMethod,
  ): Promise<string | undefined> {
    if (!this.isRemote(ctx)) {
      return undefined;
    }

    const ip = ctx.envConfig.ip!;
    const remote = this.remotePath(ctx);

    await run({
      name: "deploy",
      handler: async () => {
        await this.shell.run("tar czf dist.tar.gz dist", { root: ctx.root });
        await this.ssh.exec(ip, `mkdir -p ${remote}`);
        await this.ssh.upload(
          ip,
          this.fs.join(ctx.root, "dist.tar.gz"),
          `${remote}/dist.tar.gz`,
        );
        await this.ssh.exec(
          ip,
          `cd ${remote} && tar xzf dist.tar.gz && docker compose build && docker compose up -d`,
        );
      },
    });

    return ctx.envConfig.domain ? `https://${ctx.envConfig.domain}` : undefined;
  }

  // ---------------------------------------------------------------------------
  // provision
  // ---------------------------------------------------------------------------

  async provision(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const envVars = await this.envUtils.parseEnv(ctx.root, [
      `.env.${ctx.env}`,
      ".env",
    ]);

    if (this.isRemote(ctx)) {
      await this.provisionRemote(ctx, run, envVars);
    } else {
      await this.provisionLocal(ctx, run, envVars);
    }
  }

  protected async provisionLocal(
    ctx: PlatformContext,
    run: RunnerMethod,
    envVars: Record<string, string>,
  ): Promise<void> {
    const compose = this.generator.generateLocal({
      project: ctx.project,
      env: ctx.env,
      naming: ctx.naming,
      apps: ctx.apps,
      envVars,
    });

    if (!compose) {
      return;
    }

    await run({
      name: "provision (docker compose)",
      handler: async () => {
        const composePath = this.composePath(ctx);
        await this.fs.mkdir(dirname(composePath), { recursive: true });
        await this.fs.writeFile(composePath, compose);

        await this.shell.run(
          `docker compose -f ${composePath} -p ${ctx.project}-${ctx.env} up -d`,
        );
      },
    });
  }

  protected async provisionRemote(
    ctx: PlatformContext,
    run: RunnerMethod,
    envVars: Record<string, string>,
  ): Promise<void> {
    const ip = ctx.envConfig.ip!;
    const remote = this.remotePath(ctx);

    // Provision shared Traefik if any domain is configured
    const hasDomain =
      !!ctx.envConfig.domain ||
      Object.keys(ctx.envConfig.domains ?? {}).length > 0;

    if (hasDomain) {
      await this.ensureTraefik(ip, run);
    }

    // Generate project compose (never contains Traefik)
    const compose = this.generator.generateRemote({
      project: ctx.project,
      env: ctx.env,
      naming: ctx.naming,
      domain: ctx.envConfig.domain,
      domains: ctx.envConfig.domains,
      apps: ctx.apps,
      envVars,
    });

    await run({
      name: "provision (remote)",
      handler: async () => {
        const localCompose = this.composePath(ctx);
        await this.fs.mkdir(dirname(localCompose), { recursive: true });
        await this.fs.writeFile(localCompose, compose);

        await this.ssh.exec(ip, `mkdir -p ${remote}`);
        await this.ssh.upload(ip, localCompose, `${remote}/docker-compose.yml`);

        const envFile = this.fs.join(ctx.root, `.env.${ctx.env}`);
        if (await this.fs.exists(envFile)) {
          await this.ssh.upload(ip, envFile, `${remote}/.env.${ctx.env}`);
        }
      },
    });
  }

  /**
   * Ensure the shared Traefik instance is running on the VPS.
   * If already running, this is a no-op.
   */
  protected async ensureTraefik(ip: string, run: RunnerMethod): Promise<void> {
    const output = await this.ssh.exec(
      ip,
      `docker ps --filter name=${this.TRAEFIK_CONTAINER} --format '{{.Names}}'`,
    );

    if (output.trim() === this.TRAEFIK_CONTAINER) {
      return;
    }

    await run({
      name: "provision (shared traefik)",
      handler: async () => {
        const traefikCompose = this.generator.generateTraefik();
        const localPath = this.fs.join(
          "node_modules/.alepha/traefik-compose.yml",
        );
        await this.fs.mkdir(dirname(localPath), { recursive: true });
        await this.fs.writeFile(localPath, traefikCompose);

        await this.ssh.exec(ip, `mkdir -p ${this.TRAEFIK_PATH}`);
        await this.ssh.upload(
          ip,
          localPath,
          `${this.TRAEFIK_PATH}/docker-compose.yml`,
        );
        await this.ssh.exec(
          ip,
          `cd ${this.TRAEFIK_PATH} && docker compose up -d`,
        );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // migrate
  // ---------------------------------------------------------------------------

  async migrate(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    const hasDatabase = ctx.apps.some((app) => app.resources.hasDatabase);
    if (!hasDatabase) {
      return;
    }

    await run({
      name: "migrate",
      handler: async () => {
        if (this.isRemote(ctx)) {
          const ip = ctx.envConfig.ip!;
          const remote = this.remotePath(ctx);
          await this.ssh.exec(
            ip,
            `cd ${remote} && docker compose exec app node -e "require('./migrate')"`,
          );
        } else {
          await this.shell.run("alepha db migrations apply", {
            root: ctx.root,
          });
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // secrets
  // ---------------------------------------------------------------------------

  async secrets(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    if (!this.isRemote(ctx)) {
      return;
    }

    const ip = ctx.envConfig.ip!;
    const remote = this.remotePath(ctx);
    const envFile = this.fs.join(ctx.root, `.env.${ctx.env}`);

    if (!(await this.fs.exists(envFile))) {
      return;
    }

    await run({
      name: "push secrets",
      handler: async () => {
        await this.ssh.upload(ip, envFile, `${remote}/.env.${ctx.env}`);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // inspect
  // ---------------------------------------------------------------------------

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

    await run({
      name: "inspect",
      handler: async () => {
        if (this.isRemote(ctx)) {
          const ip = ctx.envConfig.ip!;
          const remote = this.remotePath(ctx);
          try {
            const output = await this.ssh.exec(
              ip,
              `cd ${remote} && docker compose ps --format json 2>/dev/null || echo "[]"`,
            );
            const containers = this.parseContainers(output);
            for (const c of containers) {
              state.workers.push({
                name: c.name,
                exists: c.state === "running",
                detail: c.state,
              });
            }
          } catch {
            // Remote not reachable or no compose — empty state
          }
        } else {
          const composePath = this.composePath(ctx);
          if (await this.fs.exists(composePath)) {
            try {
              const output = await this.shell.run(
                `docker compose -f ${composePath} -p ${ctx.project}-${ctx.env} ps --format json`,
                { capture: true },
              );
              const containers = this.parseContainers(output);
              for (const c of containers) {
                state.workers.push({
                  name: c.name,
                  exists: c.state === "running",
                  detail: c.state,
                });
              }
            } catch {
              // Compose not running — empty state
            }
          }
        }
      },
    });

    return state;
  }

  // ---------------------------------------------------------------------------
  // teardown
  // ---------------------------------------------------------------------------

  async teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void> {
    await run({
      name: "teardown",
      handler: async () => {
        if (this.isRemote(ctx)) {
          const ip = ctx.envConfig.ip!;
          const remote = this.remotePath(ctx);
          await this.ssh.exec(ip, `cd ${remote} && docker compose down`);
        } else {
          const composePath = this.composePath(ctx);
          if (await this.fs.exists(composePath)) {
            await this.shell.run(
              `docker compose -f ${composePath} -p ${ctx.project}-${ctx.env} down`,
            );
          }
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  protected parseContainers(
    output: string,
  ): Array<{ name: string; state: string }> {
    try {
      const lines = output.trim().split("\n").filter(Boolean);
      return lines.map((line) => {
        const obj = JSON.parse(line);
        return {
          name: obj.Name ?? obj.Service ?? "unknown",
          state: obj.State ?? "unknown",
        };
      });
    } catch {
      return [];
    }
  }
}
