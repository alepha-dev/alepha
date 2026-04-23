import { $inject, Alepha, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import type {
  AppDefinition,
  PlatformAdapter,
  PlatformContext,
  PlatformState,
} from "../adapters/PlatformAdapter.ts";
import { VercelAdapter } from "../adapters/VercelAdapter.ts";
import {
  PlatformHook,
  type PlatformHookContext,
} from "../hooks/PlatformHook.ts";
import { type NamingContext, NamingService } from "./NamingService.ts";
import {
  PlatformInspector,
  type ResolvedPlatformConfig,
} from "./PlatformInspector.ts";

/**
 * Orchestrates platform lifecycle operations.
 *
 * Coordinates adapter calls in the correct order for
 * up (build -> migrate -> deploy), down, plan, and status.
 */
export class PlatformOrchestrator {
  protected readonly log = $logger();
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly inspector = $inject(PlatformInspector);
  protected readonly naming = $inject(NamingService);
  protected readonly cloudflareAdapter = $inject(CloudflareAdapter);
  protected readonly vercelAdapter = $inject(VercelAdapter);
  protected readonly alepha = $inject(Alepha);

  // -------------------------------------------------------------------------
  // Adapter resolution
  // -------------------------------------------------------------------------

  public resolveAdapter(adapterName: string): PlatformAdapter {
    switch (adapterName) {
      case "cloudflare":
        return this.cloudflareAdapter;
      case "vercel":
        return this.vercelAdapter;
      default:
        throw new AlephaError(`Unknown adapter: "${adapterName}"`);
    }
  }

  // -------------------------------------------------------------------------
  // up
  // -------------------------------------------------------------------------

  public async up(options: {
    root: string;
    env: string;
    app?: string;
    apps: AppDefinition[];
    run: RunnerMethod;
  }): Promise<void> {
    const { root, env, app: appFilter, apps, run } = options;
    const envConfig = await this.inspector.resolveEnvironment(root, env);
    const config = await this.inspector.resolveConfig(root);
    const adapter = this.resolveAdapter(envConfig.adapter);
    const namingCtx = this.naming.forContext(config.project, env);

    const ctx: PlatformContext = {
      project: config.project,
      env,
      envConfig,
      apps,
      root,
      naming: namingCtx,
    };

    // 1. Auth
    await adapter.authenticate(ctx, run);

    // 2. Filter apps
    const targetApps = appFilter
      ? apps.filter((a) => a.name === appFilter)
      : apps;

    if (targetApps.length === 0 && appFilter) {
      throw new AlephaError(
        `App "${appFilter}" not found. Available: ${apps.map((a) => a.name).join(", ")}`,
      );
    }

    // 3. Provision (before build so resource IDs are available for wrangler config)
    await adapter.provision(ctx, run);

    // 4. Build
    for (const a of targetApps) {
      await adapter.build({ ...ctx, app: a }, run);
    }

    // 5. Migrate
    await adapter.migrate(ctx, run);

    // 6. Deploy
    const urls: string[] = [];
    for (const a of targetApps) {
      const url = await adapter.deploy({ ...ctx, app: a }, run);
      if (url) {
        urls.push(url);
      }
    }

    // 7. Platform hooks (register external resources: Stripe webhooks, etc.)
    //    Run before secrets() so any secret a hook writes to .env.<env>
    //    gets pushed to the deployed worker in the same up cycle.
    await this.runHooks("register", ctx, urls, run);

    // 8. Secrets (push .env.{env} secrets to deployed workers)
    await adapter.secrets(ctx, run);

    run.end();

    const c = this.color;

    if (envConfig.domain) {
      this.log.info("");
      this.log.info(
        `  ${c.set("GREEN", "\u2192")} ${c.set("CYAN", `https://${envConfig.domain}`)}`,
      );
      this.log.info("");
    } else {
      for (const url of urls) {
        this.log.info("");
        this.log.info(`  ${c.set("GREEN", "\u2192")} ${c.set("CYAN", url)}`);
        this.log.info("");
      }
    }
  }

  // -------------------------------------------------------------------------
  // down
  // -------------------------------------------------------------------------

  public async down(options: {
    root: string;
    env: string;
    app?: string;
    apps: AppDefinition[];
    run: RunnerMethod;
    confirm: (prompt: string) => Promise<string>;
  }): Promise<boolean> {
    const { root, env, app: appFilter, apps, run, confirm } = options;
    const envConfig = await this.inspector.resolveEnvironment(root, env);
    const config = await this.inspector.resolveConfig(root);
    const adapter = this.resolveAdapter(envConfig.adapter);
    const namingCtx = this.naming.forContext(config.project, env);

    const ctx: PlatformContext = {
      project: config.project,
      env,
      envConfig,
      apps: appFilter ? apps.filter((a) => a.name === appFilter) : apps,
      root,
      naming: namingCtx,
    };

    // Confirm (skip for tmp envs)
    if (!this.isTmpEnv(env)) {
      const answer = await confirm(`Type "${env}" to confirm teardown:`);

      if (answer !== env) {
        this.log.info("Aborted.");
        return false;
      }
    }

    // Auth
    await adapter.authenticate(ctx, run);

    // Platform hooks (tear down external resources first, while creds still valid)
    await this.runHooks("unregister", ctx, [], run);

    // Teardown
    await adapter.teardown(ctx, run);
    run.end();

    return true;
  }

  // -------------------------------------------------------------------------
  // Platform hooks
  // -------------------------------------------------------------------------

  /**
   * Run all registered PlatformHook instances.
   *
   * Discovered dynamically via `alepha.services(PlatformHook)`: any plugin
   * that registers a PlatformHook subclass in its `$module.services`
   * participates automatically, without the core knowing about it.
   */
  protected async runHooks(
    phase: "register" | "unregister",
    ctx: PlatformContext,
    deployUrls: string[],
    run: RunnerMethod,
  ): Promise<void> {
    const hooks = this.alepha.services(PlatformHook);
    if (hooks.length === 0) return;

    const baseUrl = ctx.envConfig.domain
      ? `https://${ctx.envConfig.domain}`
      : deployUrls[0];

    if (!baseUrl) {
      this.log.debug("Skipping platform hooks: no base URL available");
      return;
    }

    const hookCtx: PlatformHookContext = { ...ctx, baseUrl, run };

    for (const hook of hooks) {
      this.log.debug(`Platform hook: ${hook.name} (${phase})`);
      try {
        if (phase === "register") {
          await hook.register(hookCtx);
        } else {
          await hook.unregister(hookCtx);
        }
      } catch (err) {
        // unregister must never block teardown
        if (phase === "unregister") {
          this.log.debug(
            `Platform hook ${hook.name} failed to unregister: ${(err as Error).message}`,
          );
        } else {
          throw err;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // plan
  // -------------------------------------------------------------------------

  public async plan(options: {
    root: string;
    env: string;
    apps: AppDefinition[];
  }): Promise<{
    config: ResolvedPlatformConfig;
    naming: NamingContext;
    apps: AppDefinition[];
  }> {
    const { root, env, apps } = options;
    const config = await this.inspector.resolveConfig(root);
    const namingCtx = this.naming.forContext(config.project, env);
    return { config, naming: namingCtx, apps };
  }

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  public async status(options: {
    root: string;
    env: string;
    apps: AppDefinition[];
    run: RunnerMethod;
  }): Promise<{ config: ResolvedPlatformConfig; state: PlatformState }> {
    const { root, env, apps, run } = options;
    const envConfig = await this.inspector.resolveEnvironment(root, env);
    const config = await this.inspector.resolveConfig(root);
    const adapter = this.resolveAdapter(envConfig.adapter);
    const namingCtx = this.naming.forContext(config.project, env);

    const ctx: PlatformContext = {
      project: config.project,
      env,
      envConfig,
      apps,
      root,
      naming: namingCtx,
    };

    await adapter.authenticate(ctx, run);
    const state = await adapter.inspect(ctx, run);

    return { config, state };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  public isTmpEnv(env: string): boolean {
    return env.startsWith("tmp");
  }
}
