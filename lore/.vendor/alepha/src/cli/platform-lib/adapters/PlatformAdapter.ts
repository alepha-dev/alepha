import { AlephaError, type InstantiableClass, type ZType } from "alepha";
import type { AppEntry } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";

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
  /**
   * Write placeholder blobs for every exported file row, so a local dev
   * server answers with a stand-in image instead of 404 for objects that
   * stayed in remote storage. Defaults to true, and is ignored when
   * `output` points somewhere other than the dev database.
   */
  placeholders?: boolean;
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface DetectedResources {
  hasDatabase: boolean;
  hasBucket: boolean;
  hasAnalytics: boolean;
  hasKV: boolean;
  hasQueue: boolean;
  hasCron: boolean;
  /**
   * The app opens websockets, which on Cloudflare means a Durable Object.
   *
   * ⚠️ The manifest has carried this since websockets shipped and the deploy
   * chain dropped it here, so no adapter could know a copy runs a DO namespace
   * - and DO storage is DATA, in the same sense a D1 database is. A teardown
   * that cannot see it cannot decide whether it is allowed to take it.
   *
   * Optional because a manifest written before this field existed has none,
   * and absent must read as "unknown", never as "no websockets" - the
   * difference decides whether a script delete may be forced.
   */
  hasWebSocket?: boolean;
}

/**
 * One workspace = one app. Used to be a per-app definition in a
 * monorepo-aware orchestrator; flattened into `PlatformContext` after
 * the `apps:` field was removed from platform options.
 */
export interface PlatformContext<TOptions = unknown> {
  /**
   * Slugified app name (`platform().name`, else the workspace package.json).
   */
  project: string;

  /**
   * Environment key (e.g., "production", "staging", "tmp-bug001").
   */
  env: string;

  /**
   * The environment's options, as its factory declared them and validated
   * against the adapter's `static options` schema.
   */
  options: TOptions;

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
   * Resource name generator bound to this project+env.
   */
  naming: NamingContext;

  /**
   * Pre-built mode. When true, the adapter's `build()` should skip the
   * Vite bundle steps and only regenerate the deploy config
   * (wrangler.jsonc, Dockerfile, etc.) so it reflects current bindings +
   * per-deploy overrides.
   */
  prebuilt?: boolean;
}

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
// Environment descriptor
// ---------------------------------------------------------------------------

/**
 * An adapter class, with the two statics every adapter declares.
 *
 * They are statics because they are needed before an adapter is resolved:
 * `options` validates an environment when it is resolved, and `id` names the
 * adapter in `plan` and `status` output. `id` is display only, never a lookup
 * key: the class itself is the adapter's identity.
 */
export type PlatformAdapterClass<TOptions = any> = InstantiableClass<
  PlatformAdapter<TOptions>
> & {
  /**
   * Display name, e.g. `"cloudflare"`. Emitted as `adapter` by
   * `platform plan --json` and `platform status --json`.
   */
  readonly id: string;
  /**
   * The schema of the options this adapter reads from `ctx.options`.
   */
  readonly options: ZType;
};

/**
 * One environment of `platform({ environments })`, as an adapter factory
 * returns it: the adapter class and its own options.
 *
 * A third-party factory declares this as its return type, so the published
 * `.d.ts` names neither its adapter class nor anything that class injects.
 */
export interface EnvironmentDescriptor<TOptions = any> {
  adapter: PlatformAdapterClass<TOptions>;
  options: TOptions;
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * Abstract platform adapter.
 *
 * Each provider implements this, and names itself to `alepha.config.ts`
 * through a factory returning an {@link EnvironmentDescriptor}. A subclass
 * declares `static readonly id` and `static readonly options` (see
 * {@link PlatformAdapterClass}), and reads its options from `ctx.options`.
 * The PlatformOrchestrator calls these methods in the correct order.
 */
export abstract class PlatformAdapter<TOptions = unknown> {
  /**
   * Ensure the user is authenticated with the cloud provider.
   * May use cached credentials to avoid slow checks.
   */
  abstract authenticate(
    ctx: PlatformContext<TOptions>,
    run: RunnerMethod,
  ): Promise<void>;

  /**
   * Interactively obtain a credential and store it.
   *
   * Separate from {@link authenticate}, which must never block: `up` runs in CI,
   * where nothing can answer a prompt. This is what a human runs once, and each
   * adapter answers it in its own currency — `wrangler login` for Cloudflare, a
   * device-code flow for Bay.
   *
   * The default refuses rather than silently doing nothing: an adapter with no
   * interactive login has some other way in, and saying so beats a command that
   * appears to succeed and changes nothing.
   */
  async login(
    _ctx: PlatformContext<TOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    throw new AlephaError(
      `The '${this.constructor.name}' adapter has no interactive login. ` +
        "Authenticate with the provider's own CLI, or supply its token through " +
        "the environment.",
    );
  }

  /**
   * Discard the stored credential.
   */
  async logout(
    _ctx: PlatformContext<TOptions>,
    _run: RunnerMethod,
  ): Promise<void> {
    throw new AlephaError(
      `The '${this.constructor.name}' adapter has no interactive logout. ` +
        "Its credential is held by the provider's own CLI or by the environment.",
    );
  }

  /**
   * Build artifacts for a single app.
   */
  abstract build(
    ctx: PlatformContext<TOptions>,
    run: RunnerMethod,
  ): Promise<void>;

  /**
   * Deploy a single app (upload + activate atomically, e.g., wrangler deploy).
   * Returns the live URL if the platform provides one.
   */
  abstract deploy(
    ctx: PlatformContext<TOptions>,
    run: RunnerMethod,
  ): Promise<string | undefined>;

  /**
   * Whether this adapter puts the environment's configured `domain` into
   * effect.
   *
   * Cloudflare attaches it as a route and Bay registers it with the app, so for
   * both the config is the CAUSE of the host, and reporting it back is stating
   * something the deploy made true. An adapter that leaves host composition to
   * something else instead — a machine that names itself from the app — has no
   * channel for it, so the same line there would be a claim about a decision
   * taken somewhere else.
   *
   * It was wrong exactly once and that was enough: `up` finished green and
   * printed a link to an address answering 404 with no certificate, while the
   * site had been serving under the composed name the whole time.
   */
  readonly controlsDomain: boolean = true;

  /**
   * Whether the app runs serverless on this adapter, so resource detection
   * boots it with `ALEPHA_SERVERLESS` set (Cloudflare Workers).
   */
  readonly serverless: boolean = false;

  /**
   * Whether this adapter provisions the app's resources as Cloudflare ones
   * named by `NamingService`: a D1 database (or Hyperdrive), R2, KV,
   * Analytics and queues. `plan` lists those names, and
   * `platform db baseline mark`, which writes D1's own bookkeeping, refuses
   * any adapter without it.
   */
  readonly cloudflareResources: boolean = false;

  /**
   * Create/ensure cloud resources exist (DB, buckets, queues).
   * Not all adapters provision -- AKS defers to Helm.
   */
  async provision(
    _ctx: PlatformContext<TOptions>,
    _run: RunnerMethod,
  ): Promise<void> {}

  /**
   * Run database migrations.
   */
  async migrate(
    _ctx: PlatformContext<TOptions>,
    _run: RunnerMethod,
  ): Promise<void> {}

  /**
   * Export the deployed database to a local file — the remote → local dev
   * snapshot workflow. Adapter/dialect specific; the default refuses.
   */
  async exportDb(
    _ctx: PlatformContext<TOptions>,
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
  async secrets(
    _ctx: PlatformContext<TOptions>,
    _run: RunnerMethod,
  ): Promise<void> {}

  /**
   * Detect existing resources and their state.
   * Used by `plan` and `status` commands.
   */
  abstract inspect(
    ctx: PlatformContext<TOptions>,
    run: RunnerMethod,
  ): Promise<PlatformState>;

  /**
   * Tear down all resources for an environment.
   */
  abstract teardown(
    ctx: PlatformContext<TOptions>,
    run: RunnerMethod,
  ): Promise<void>;
}
