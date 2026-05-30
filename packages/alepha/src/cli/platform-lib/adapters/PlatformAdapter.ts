import { AlephaError } from "alepha";
import type { AppEntry } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import type { EnvironmentConfig } from "../atoms/platformOptions.ts";
import type { NamingContext } from "../services/NamingService.ts";

/**
 * Options for {@link PlatformAdapter.exportDb}.
 */
export interface ExportDbOptions {
  /**
   * Destination file for the local snapshot. Adapter-specific default —
   * Cloudflare/D1 writes the dev SQLite at
   * `node_modules/.alepha/sqlite.db`.
   */
  output?: string;
  /**
   * Keep the intermediate `.sql` dump instead of deleting it after import.
   */
  keepSql?: boolean;
}

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

/**
 * One workspace = one app. Used to be a per-app definition in a
 * monorepo-aware orchestrator; flattened into `PlatformContext` after
 * the `apps:` field was removed from platform options.
 */
export interface PlatformContext {
  /**
   * Slugified project name (from package.json or platform config).
   */
  project: string;

  /**
   * Environment key (e.g., "production", "staging", "tmp-bug001").
   */
  env: string;

  /**
   * Environment configuration from alepha.config.ts.
   */
  envConfig: EnvironmentConfig;

  /**
   * Workspace root path.
   */
  root: string;

  /**
   * Resolved entry points for the workspace. Stub (`{ root, server: "" }`)
   * in pre-built / manifest mode since no source booting happens.
   */
  entry: AppEntry;

  /**
   * Cloud resources the workspace uses — discovered at build time, read
   * from `dist/manifest.json` at deploy time.
   */
  resources: DetectedResources;

  /**
   * Resource name generator bound to this project+env(+tenant).
   */
  naming: NamingContext;

  /**
   * Active tenant slug for this deploy (apps with `tenancy: optional |
   * required`), or `undefined` for a base / non-tenanted deploy. Shapes
   * the served host (`<tenant>.<domain>`); resource names already fold it
   * in via {@link naming}.
   */
  tenant?: string;

  /**
   * Pre-built mode. When true, the adapter's `build()` should skip the
   * Vite bundle steps and only regenerate the deploy config
   * (wrangler.jsonc, Dockerfile, etc.) so it reflects current bindings +
   * per-tenant overrides.
   */
  prebuilt?: boolean;
}

/**
 * @deprecated Same as `PlatformContext` since the `apps:` collapse —
 * kept as a type alias so existing adapter signatures still compile.
 */
export type AppContext = PlatformContext;

// ---------------------------------------------------------------------------
// State types (returned by inspect)
// ---------------------------------------------------------------------------

export interface ResourceState {
  name: string;
  exists: boolean;
  id?: string;
  detail?: string;
}

export interface WorkerState extends ResourceState {
  version?: string;
  tag?: string;
  createdAt?: string;
}

export interface SecretState {
  name: string;
  deployed: boolean;
}

export interface PlatformState {
  workers: WorkerState[];
  databases: ResourceState[];
  buckets: ResourceState[];
  kvNamespaces: ResourceState[];
  queues: ResourceState[];
  secrets: SecretState[];
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
   * Deploy a single app (upload + activate atomically, e.g., wrangler deploy).
   * Returns the live URL if the platform provides one.
   */
  abstract deploy(
    ctx: AppContext,
    run: RunnerMethod,
  ): Promise<string | undefined>;

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
   * Export the deployed database to a local file — the remote → local dev
   * snapshot workflow. Adapter/dialect specific; the default refuses.
   */
  async exportDb(
    _ctx: PlatformContext,
    _run: RunnerMethod,
    _options: ExportDbOptions = {},
  ): Promise<void> {
    throw new AlephaError(
      `Database export is not supported by the '${this.constructor.name}' adapter.`,
    );
  }

  /**
   * Push runtime secrets to the deployed worker(s).
   *
   * Reads secrets from `.env.{env}` files (parsed, not from process.env),
   * filters out vars already handled by bindings (DATABASE_URL, R2, etc.),
   * and pushes the rest via the platform's secret management.
   */
  async secrets(_ctx: PlatformContext, _run: RunnerMethod): Promise<void> {}

  /**
   * Detect existing resources and their state.
   * Used by `plan` and `status` commands.
   */
  abstract inspect(
    ctx: PlatformContext,
    run: RunnerMethod,
  ): Promise<PlatformState>;

  /**
   * Tear down all resources for an environment.
   */
  abstract teardown(ctx: PlatformContext, run: RunnerMethod): Promise<void>;
}
