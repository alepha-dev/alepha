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
    apps: AppDefinition[];
    run: RunnerMethod;
    /**
     * Pre-built mode — the artifact's `dist/` is already produced.
     *
     * Still runs auth → provision → build → migrate → deploy → secrets,
     * but the `build` step shells out to `alepha build --prebuilt` which
     * only regenerates the target-specific deploy config (e.g.
     * `wrangler.jsonc`) and skips the Vite client + server builds.
     * Used by external orchestrators (Rocket) that ship a pre-built
     * `dist/` and just need the wrangler config refreshed for
     * per-tenant overrides on every deploy.
     */
    prebuilt?: boolean;
  }): Promise<{ urls: string[]; domain?: string }> {
    const { root, env, apps, run, prebuilt } = options;
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
      prebuilt,
    };

    // 1. Auth
    await adapter.authenticate(ctx, run);

    // 2. Provision (before build so resource IDs are available for wrangler config)
    await adapter.provision(ctx, run);

    // 3. Build
    //    Always runs — the adapter checks `ctx.prebuilt` to decide whether
    //    to do a full bundle build or just regenerate deploy config.
    for (const a of apps) {
      await adapter.build({ ...ctx, app: a }, run);
    }

    // 4. Migrate
    await adapter.migrate(ctx, run);

    // 5. Deploy
    const urls: string[] = [];
    for (const a of apps) {
      const url = await adapter.deploy({ ...ctx, app: a }, run);
      if (url) {
        urls.push(url);
      }
    }

    // 6. Secrets (push .env.{env} secrets to deployed workers)
    await adapter.secrets(ctx, run);

    run.end();

    return { urls, domain: envConfig.domain };
  }

  /**
   * Pretty-print the `up()` result to stdout. Matches the formatting the
   * orchestrator used to emit inline; split out so callers that want
   * JSON output can skip this branch.
   */
  public printUpSummary(result: { urls: string[]; domain?: string }): void {
    const c = this.color;
    if (result.domain) {
      this.log.info("");
      const display = result.domain.includes("*")
        ? `https://${result.domain} (wildcard route)`
        : `https://${result.domain}`;
      this.log.info(`  ${c.set("GREEN", "\u2192")} ${c.set("CYAN", display)}`);
      this.log.info("");
    } else {
      for (const url of result.urls) {
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
    apps: AppDefinition[];
    run: RunnerMethod;
    confirm: (prompt: string) => Promise<string>;
  }): Promise<boolean> {
    const { root, env, apps, run, confirm } = options;
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

    // Teardown
    await adapter.teardown(ctx, run);
    run.end();

    return true;
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
