import type { RunnerMethod } from "../../../command/helpers/Runner.ts";
import type { EnvironmentConfig } from "../../atoms/platformOptions.ts";
import type { AppEntry } from "../../providers/AppEntryProvider.ts";
import type { NamingContext } from "../services/NamingService.ts";

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface DetectedResources {
  hasDatabase: boolean;
  hasBucket: boolean;
  hasKV: boolean;
  hasQueue: boolean;
  hasCron: boolean;
}

export interface AppDefinition {
  /**
   * Slugified app name (from package.json).
   */
  name: string;

  /**
   * Relative path from root (e.g., "apps/api").
   * Empty string for standalone apps.
   */
  path: string;

  /**
   * Resolved entry points for this app.
   */
  entry: AppEntry;

  /**
   * Cloud resources detected by introspecting the app.
   */
  resources: DetectedResources;
}

export interface PlatformContext {
  /**
   * Slugified project name (from root package.json or config).
   */
  project: string;

  /**
   * Environment key (e.g., "prod", "staging", "tmp-bug001").
   */
  env: string;

  /**
   * Environment configuration from alepha.config.ts.
   */
  envConfig: EnvironmentConfig;

  /**
   * All apps in the project.
   */
  apps: AppDefinition[];

  /**
   * Monorepo/project root path.
   */
  root: string;

  /**
   * Resource name generator bound to this project+env.
   */
  naming: NamingContext;
}

export interface AppContext extends PlatformContext {
  /**
   * The specific app being operated on.
   */
  app: AppDefinition;
}

// ---------------------------------------------------------------------------
// State types (returned by inspect)
// ---------------------------------------------------------------------------

export interface ResourceState {
  name: string;
  exists: boolean;
  id?: string;
}

export interface WorkerState extends ResourceState {
  version?: string;
  tag?: string;
  createdAt?: string;
}

export interface PlatformState {
  workers: WorkerState[];
  databases: ResourceState[];
  buckets: ResourceState[];
  kvNamespaces: ResourceState[];
  queues: ResourceState[];
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * Abstract platform adapter.
 *
 * Each cloud provider (Cloudflare, AKS, docker-compose) implements this.
 * The PlatformOrchestrator calls these methods in the correct order.
 */
export abstract class PlatformAdapter {
  /**
   * Ensure the user is authenticated with the cloud provider.
   * May use cached credentials to avoid slow checks.
   */
  abstract authenticate(ctx: PlatformContext, run: RunnerMethod): Promise<void>;

  /**
   * Build artifacts for a single app.
   */
  abstract build(ctx: AppContext, run: RunnerMethod): Promise<void>;

  /**
   * Upload artifacts without activating (e.g., wrangler versions upload).
   */
  abstract push(ctx: AppContext, run: RunnerMethod): Promise<void>;

  /**
   * Activate the latest pushed version (e.g., wrangler versions deploy).
   */
  abstract activate(ctx: AppContext, run: RunnerMethod): Promise<void>;

  /**
   * Create/ensure cloud resources exist (DB, buckets, queues).
   * Not all adapters provision -- AKS defers to Helm.
   */
  async provision(_ctx: PlatformContext, _run: RunnerMethod): Promise<void> {}

  /**
   * Run database migrations.
   */
  async migrate(_ctx: PlatformContext, _run: RunnerMethod): Promise<void> {}

  /**
   * Detect existing resources and their state.
   * Used by `plan` and `status` commands.
   */
  abstract inspect(ctx: PlatformContext, run: RunnerMethod): Promise<PlatformState>;

  /**
   * Tear down all resources for an environment.
   */
  abstract teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void>;
}
