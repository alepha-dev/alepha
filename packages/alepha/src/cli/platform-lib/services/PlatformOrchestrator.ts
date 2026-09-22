import { $inject, Alepha, AlephaError } from "alepha";
import type { AppEntry } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";

import type {
  DetectedResources,
  EnvironmentDescriptor,
  PlatformAdapter,
  PlatformContext,
  PlatformState,
} from "../adapters/PlatformAdapter.ts";
import { type NamingContext, NamingService } from "./NamingService.ts";
import {
  PlatformInspector,
  type ResolvedPlatformConfig,
} from "./PlatformInspector.ts";

/**
 * One environment, resolved: its descriptor, the adapter instance and the
 * options validated against that adapter's schema.
 */
export interface ResolvedEnvironment {
  config: ResolvedPlatformConfig;
  env: string;
  descriptor: EnvironmentDescriptor;
  adapter: PlatformAdapter<any>;
  options: unknown;
}

/**
 * Orchestrates platform lifecycle operations.
 *
 * Coordinates adapter calls in the correct order for
 * up (build -> migrate -> deploy), down, plan, and status.
 */
export class PlatformOrchestrator {
  protected readonly log = $logger();
  // Resolves each adapter, and the substitutes a test subclass provides for
  // them.
  protected readonly alepha = $inject(Alepha);
  protected readonly color = $inject(ConsoleColorProvider);
  protected readonly inspector = $inject(PlatformInspector);
  protected readonly naming = $inject(NamingService);

  // -------------------------------------------------------------------------
  // Environment resolution
  // -------------------------------------------------------------------------

  /**
   * The adapter instance an environment's descriptor names.
   *
   * ⚠️ No field per adapter, so importing this file imports no adapter. A
   * class field is eager: `$inject(BayAdapter)` here put `node:child_process`
   * in the module graph of anything that so much as typed against the
   * orchestrator, which is what stopped it being bundled for a Worker. The
   * descriptor carries the class, and `inject` is what instantiates it.
   *
   * The class must already be registered: `inject` after `start()` refuses a
   * service whose module never was. `platform()` registers every descriptor's
   * adapter when the config loads, and a caller writing `platformOptions`
   * itself registers its own.
   */
  public resolveAdapter(
    descriptor: EnvironmentDescriptor,
  ): PlatformAdapter<any> {
    return this.alepha.inject(descriptor.adapter);
  }

  /**
   * Resolve one environment: refuse a name the config does not have, validate
   * its options against its adapter's `static options`, and resolve the
   * adapter.
   *
   * A bad option is refused here, by environment name, before any adapter
   * method runs, rather than surfacing as an adapter reading `undefined`
   * halfway through a deploy.
   */
  public async resolveEnvironment(
    root: string,
    env?: string,
  ): Promise<ResolvedEnvironment> {
    const config = await this.inspector.resolveConfig(root);
    const name = env ?? config.defaultEnv;
    const descriptor = await this.inspector.resolveEnvironment(root, name);
    const options = this.validateOptions(name, descriptor);
    const adapter = this.resolveAdapter(descriptor);
    return { config, env: name, descriptor, adapter, options };
  }

  /**
   * Build the context every adapter method receives.
   */
  public createContext(
    target: ResolvedEnvironment,
    parts: {
      root: string;
      entry: AppEntry;
      resources: DetectedResources;
      prebuilt?: boolean;
    },
  ): PlatformContext<any> {
    return {
      project: target.config.project,
      env: target.env,
      options: target.options,
      root: parts.root,
      entry: parts.entry,
      resources: parts.resources,
      naming: this.naming.forContext(target.config.project, target.env),
      prebuilt: parts.prebuilt,
    };
  }

  protected validateOptions(
    env: string,
    descriptor: EnvironmentDescriptor,
  ): unknown {
    const result = descriptor.adapter.options.safeParse(
      descriptor.options ?? {},
    );
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) =>
          issue.path.length > 0
            ? `${issue.path.join(".")}: ${issue.message}`
            : issue.message,
        )
        .join("; ");
      throw new AlephaError(
        `Environment "${env}" has invalid options for the '${descriptor.adapter.id}' adapter: ${issues}`,
      );
    }
    return result.data;
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
    const target = await this.resolveEnvironment(options.root, options.env);
    const ctx = this.createContext(target, options);
    await target.adapter[options.action](ctx, options.run);
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
     * per-deploy overrides on every deploy.
     */
    prebuilt?: boolean;
  }): Promise<{ urls: string[]; domain?: string }> {
    const { root, env, run } = options;
    const target = await this.resolveEnvironment(root, env);
    const { adapter } = target;
    const ctx = this.createContext(target, options);

    await adapter.authenticate(ctx, run);
    await adapter.provision(ctx, run);
    // `build` always runs — adapter checks `ctx.prebuilt` to decide
    // whether to do a full bundle build or only regenerate deploy config.
    await adapter.build(ctx, run);
    await adapter.migrate(ctx, run);
    // NOTE: on Cloudflare the secrets travel IN the upload, so `deploy` is
    // one Worker version and `secrets` is a no-op there. Both adapters send
    // them as `secret_text` bindings of the script: `WorkerCloudflareAdapter`
    // in its own multipart upload, `CloudflareAdapter` through
    // `wrangler deploy --secrets-file`. That closes the window the old order
    // opened, in which the new build ran against the previous secret set (a
    // newly required secret missing, APP_SECRET failing closed) and a first
    // deploy served with none at all, and it removes the second version
    // every `up` used to publish.
    //
    // `secrets` stays after `deploy` for adapters that still push separately
    // (Bay), where the target has to exist first.
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
        ? this.inspector.domainOf(target.descriptor)
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
      const display = `https://${result.domain}`;
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
  }): Promise<boolean> {
    const { root, env, run, confirm } = options;
    const target = await this.resolveEnvironment(root, env);
    const { adapter } = target;
    const ctx = this.createContext(target, options);

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
  }): Promise<{
    config: ResolvedPlatformConfig;
    naming: NamingContext;
    resources: DetectedResources;
  }> {
    const { root, env, resources } = options;
    const config = await this.inspector.resolveConfig(root);
    const namingCtx = this.naming.forContext(config.project, env);
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
  }): Promise<{ config: ResolvedPlatformConfig; state: PlatformState }> {
    const { root, env, run } = options;
    const target = await this.resolveEnvironment(root, env);
    const { adapter } = target;
    const ctx = this.createContext(target, options);

    await adapter.authenticate(ctx, run);
    const state = await adapter.inspect(ctx, run);

    return { config: target.config, state };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  public isTmpEnv(env: string): boolean {
    return env.startsWith("tmp");
  }
}
