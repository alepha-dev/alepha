import { $inject, Alepha, AlephaError } from "alepha";
import type { AppEntry } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { BayAdapter } from "../adapters/BayAdapter.ts";
import { CloudflareAdapter } from "../adapters/CloudflareAdapter.ts";
import { LoreAdapter } from "../adapters/LoreAdapter.ts";
import type {
  DetectedResources,
  PlatformAdapter,
  PlatformContext,
  PlatformState,
} from "../adapters/PlatformAdapter.ts";
import {
  type NamingContext,
  NamingService,
  resolveTenant,
  tenantDomain,
} from "./NamingService.ts";
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
  protected readonly bayAdapter = $inject(BayAdapter);
  protected readonly cloudflareAdapter = $inject(CloudflareAdapter);
  protected readonly loreAdapter = $inject(LoreAdapter);
  protected readonly alepha = $inject(Alepha);

  // -------------------------------------------------------------------------
  // Adapter resolution
  // -------------------------------------------------------------------------

  public resolveAdapter(adapterName: string): PlatformAdapter {
    switch (adapterName) {
      case "cloudflare":
        return this.cloudflareAdapter;
      case "bay":
        return this.bayAdapter;
      case "lore":
        return this.loreAdapter;
      default:
        throw new AlephaError(`Unknown adapter: "${adapterName}"`);
    }
  }

  // -------------------------------------------------------------------------
  // auth
  // -------------------------------------------------------------------------

  /**
   * Runs the adapter's interactive login or logout.
   *
   * Each adapter answers in its own currency — `wrangler login` for Cloudflare,
   * a device-code flow for Bay — so the command stays one thing to learn while
   * the mechanism stays the adapter's business.
   */
  public async auth(options: {
    root: string;
    env: string;
    entry: AppEntry;
    resources: DetectedResources;
    run: RunnerMethod;
    action: "login" | "logout";
  }): Promise<void> {
    const config = await this.inspector.resolveConfig(options.root);
    const envConfig = config.environments[options.env];
    if (!envConfig) {
      throw new AlephaError(
        `No environment "${options.env}" in alepha.config.ts.`,
      );
    }
    const adapter = this.resolveAdapter(envConfig.adapter);
    const ctx: PlatformContext = {
      project: config.project,
      env: options.env,
      envConfig,
      root: options.root,
      entry: options.entry,
      resources: options.resources,
      naming: this.naming.forContext(config.project, options.env),
    };
    await adapter[options.action](ctx, options.run);
  }

  // -------------------------------------------------------------------------
  // up
  // -------------------------------------------------------------------------

  public async up(options: {
    root: string;
    env: string;
    entry: AppEntry;
    resources: DetectedResources;
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
    /** Tenant slug (apps with tenancy optional|required). */
    tenant?: string;
  }): Promise<{ urls: string[]; domain?: string }> {
    const { root, env, entry, resources, run, prebuilt } = options;
    const envConfig = await this.inspector.resolveEnvironment(root, env);
    const config = await this.inspector.resolveConfig(root);
    const adapter = this.resolveAdapter(envConfig.adapter);
    const tenant = resolveTenant(config.tenancy, options.tenant);
    const namingCtx = this.naming.forContext(config.project, env, tenant);

    const ctx: PlatformContext = {
      project: config.project,
      env,
      envConfig,
      root,
      entry,
      resources,
      naming: namingCtx,
      tenant,
      prebuilt,
    };

    await adapter.authenticate(ctx, run);
    await adapter.provision(ctx, run);
    // `build` always runs — adapter checks `ctx.prebuilt` to decide
    // whether to do a full bundle build or only regenerate deploy config.
    await adapter.build(ctx, run);
    await adapter.migrate(ctx, run);
    // NOTE: code lands before secrets, which opens a window (~6s observed
    // on Cloudflare) where the new build runs against the previous
    // secret set. Harmless for a rotation, but a deploy that introduces a
    // *newly required* secret will boot without it for that window — and
    // a provider that fails closed on a missing secret (as Alepha does
    // for APP_SECRET) will refuse requests until the push lands.
    //
    // It is this way round because `secret put` needs the worker to
    // exist: on a first deploy there is nothing to attach secrets to.
    // Closing the window properly means pushing secrets first when the
    // worker already exists and falling back to after when it does not —
    // worth doing, but it must not break bootstrapping, so it wants a
    // real deploy test behind it rather than a reordered line.
    const url = await adapter.deploy(ctx, run);
    await adapter.secrets(ctx, run);

    run.end();

    return {
      urls: url ? [url] : [],
      // Only when the adapter is what puts that domain into effect. Reported
      // unconditionally, an adapter that does not choose the host had its own
      // config echoed back as the deploy's address — see
      // `PlatformAdapter.controlsDomain`.
      domain: adapter.controlsDomain
        ? tenantDomain(envConfig.domain, tenant)
        : undefined,
    };
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
    entry: AppEntry;
    resources: DetectedResources;
    run: RunnerMethod;
    confirm: (prompt: string) => Promise<string>;
    /** Tenant slug (apps with tenancy optional|required). */
    tenant?: string;
  }): Promise<boolean> {
    const { root, env, entry, resources, run, confirm } = options;
    const envConfig = await this.inspector.resolveEnvironment(root, env);
    const config = await this.inspector.resolveConfig(root);
    const adapter = this.resolveAdapter(envConfig.adapter);
    const tenant = resolveTenant(config.tenancy, options.tenant);
    const namingCtx = this.naming.forContext(config.project, env, tenant);

    const ctx: PlatformContext = {
      project: config.project,
      env,
      envConfig,
      root,
      entry,
      resources,
      naming: namingCtx,
      tenant,
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
    resources: DetectedResources;
    /** Tenant slug (apps with tenancy optional|required). */
    tenant?: string;
  }): Promise<{
    config: ResolvedPlatformConfig;
    naming: NamingContext;
    resources: DetectedResources;
  }> {
    const { root, env, resources } = options;
    const config = await this.inspector.resolveConfig(root);
    const tenant = resolveTenant(config.tenancy, options.tenant);
    const namingCtx = this.naming.forContext(config.project, env, tenant);
    return { config, naming: namingCtx, resources };
  }

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  public async status(options: {
    root: string;
    env: string;
    entry: AppEntry;
    resources: DetectedResources;
    run: RunnerMethod;
    /** Tenant slug (apps with tenancy optional|required). */
    tenant?: string;
  }): Promise<{ config: ResolvedPlatformConfig; state: PlatformState }> {
    const { root, env, entry, resources, run } = options;
    const envConfig = await this.inspector.resolveEnvironment(root, env);
    const config = await this.inspector.resolveConfig(root);
    const adapter = this.resolveAdapter(envConfig.adapter);
    const tenant = resolveTenant(config.tenancy, options.tenant);
    const namingCtx = this.naming.forContext(config.project, env, tenant);

    const ctx: PlatformContext = {
      project: config.project,
      env,
      envConfig,
      root,
      entry,
      resources,
      naming: namingCtx,
      tenant,
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
