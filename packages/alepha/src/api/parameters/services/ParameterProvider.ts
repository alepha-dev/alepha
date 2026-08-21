import {
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Infer,
  SchemaValidator,
  type ZObject,
  z,
} from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { LockProvider } from "alepha/lock";
import { $logger } from "alepha/logger";
import { $repository, RepositoryProvider } from "alepha/orm";
import {
  currentTenantAtom,
  currentUserAtom,
  tenancyAtom,
} from "alepha/security";
import { $topic } from "alepha/topic";

import { type Parameter, parameters } from "../entities/parameters.ts";
import type { ParameterPrimitive } from "../primitives/$parameter.ts";
import type { ParameterStatus } from "../schemas/parameterStatusSchema.ts";
import type { ParameterTreeNode } from "../schemas/parameterTreeNodeSchema.ts";

/**
 * Payload for parameter change events across instances.
 */
export interface ParameterChangePayload {
  name: string;
  instanceId: string;
}

/**
 * A parameter with a calculated status field.
 */
export type ParameterWithStatus = Parameter & { status: ParameterStatus };

/**
 * ParameterProvider manages versioned parameter persistence, caching,
 * migration, and synchronization.
 *
 * Features:
 * - Stores all parameter versions in the database
 * - Derives status from activationDate at query time (no stored status)
 * - Provides cross-instance notification via topic
 * - Supports schema migrations via hash comparison
 * - Manages per-parameter caching, loading, and subscriber notification
 */
export class ParameterProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly lockProvider = $inject(LockProvider);
  protected readonly schemaValidator = $inject(SchemaValidator);
  protected readonly repositoryProvider = $inject(RepositoryProvider);
  protected readonly repo = $repository(parameters);

  /**
   * Unique identifier for this instance (to avoid self-updates).
   */
  protected get instanceId(): string {
    this._instanceId ??= this.crypto.randomUUID();
    return this._instanceId;
  }

  protected _instanceId: string | undefined;

  /**
   * Resolve the active tenant for cache keying — MIRRORS the Repository's
   * `resolveOrganizationValue` (tenant atom → user org) so the in-memory
   * value caches partition exactly the way the DB rows do. Returns a sentinel
   * for the org-less (single-tenant / no-request) case.
   *
   * Why this matters: the DB table is now org-scoped, but these process-global
   * Maps are keyed by parameter NAME — without folding the org into the key, a
   * pooled multi-tenant worker would hand org A's cached `club.settings` to a
   * request for org B. (Cross-instance topic sync + the `ready` preload run
   * with no request atom → the sentinel key; they refresh only org-less rows,
   * leaving per-org caches to lazy-load + the immediate local update on `set`.
   * That is bounded staleness, never a cross-tenant read.)
   */
  protected orgKey(): string {
    const tenant = this.alepha.store.get(currentTenantAtom);
    if (tenant?.id) return tenant.id;
    const user = this.alepha.store.get(currentUserAtom);
    return user?.organization ?? "~global";
  }

  /** Per-org cache key for the value caches (`${org}:${name}`). */
  protected cacheKey(name: string): string {
    return `${this.orgKey()}:${name}`;
  }

  /**
   * In-memory cache of registered parameter primitives. Keyed by NAME only —
   * the `$parameter` definition (schema + default) is identical for every
   * tenant; only the stored VALUE is per-org (see the value caches below).
   */
  protected readonly primitives = new Map<string, ParameterPrimitive<any>>();

  /**
   * In-memory cached current content per parameter.
   */
  protected readonly cachedCurrent = new Map<string, unknown>();

  /**
   * In-memory cached next version info per parameter.
   */
  protected readonly cachedNext = new Map<
    string,
    { content: unknown; activationDate: string }
  >();

  /**
   * Set of parameter names that have completed initial load.
   */
  protected readonly loaded = new Set<string>();

  /**
   * Epoch millis of the last successful load (or local set) per cache key.
   * Drives the serverless revalidation TTL (see `revalidateAfterMs`).
   */
  protected readonly loadedAt = new Map<string, number>();

  /**
   * How long a cached value may serve before `get()` re-reads the DB.
   *
   * The in-memory caches are PER ISOLATE. On serverless runtimes
   * (Cloudflare Workers) many isolates serve the same app and the
   * cross-instance `syncTopic` rides the queue provider — in-memory by
   * default, so a `set()` handled by one isolate never reaches the others:
   * without a TTL they serve the stale value until they are recycled.
   *
   * Defaults: 30 s on serverless, 0 (= never revalidate, the historical
   * behaviour) elsewhere. Override with the `PARAMETERS_CACHE_TTL_MS` env.
   */
  protected get revalidateAfterMs(): number {
    const raw = this.alepha.env.PARAMETERS_CACHE_TTL_MS as
      | string
      | number
      | undefined;
    if (raw !== undefined && raw !== "") return Number(raw);
    return this.alepha.isServerless() ? 30_000 : 0;
  }

  /**
   * Shared promises for deduplicating concurrent load() calls.
   */
  protected readonly loadPromises = new Map<string, Promise<void>>();

  /**
   * Generation counter per parameter — incremented on each doLoad call.
   * Used to discard results from superseded loads.
   */
  protected readonly loadGeneration = new Map<string, number>();

  /**
   * Subscriber callbacks per parameter name.
   */
  protected readonly subscribers = new Map<
    string,
    Array<(v: unknown) => void>
  >();

  /**
   * Set of parameter names that have already been checked for migration.
   */
  protected readonly migrationChecked = new Set<string>();

  /**
   * Computed schema hashes per parameter name.
   */
  protected readonly schemaHashes = new Map<string, string>();

  /**
   * Pre-load all registered parameters on ready (non-serverless, single-tenant
   * only).
   *
   * The preload runs with no request atom, so it can only ever touch the
   * org-less rows. Under `tenancy: "multi"` an org-scoped query with no
   * resolved tenant fails closed by design, so there is nothing this pass can
   * legitimately warm — every value is per-org and loads lazily on the first
   * request that carries a tenant. Skipping keeps a multi-tenant app bootable.
   * (Serverless already skips it, which is where multi-tenant apps typically
   * run anyway.)
   */
  protected readonly onReady = $hook({
    on: "ready",
    handler: async () => {
      if (this.alepha.isServerless()) {
        return;
      }
      if (this.alepha.store.get(tenancyAtom).mode === "multi") {
        return;
      }
      for (const name of this.primitives.keys()) {
        await this.migrateWithLock(name);
      }
    },
  });

  /**
   * Topic for cross-instance change notification.
   * Payload is minimal — receivers call load() to fetch fresh data.
   */
  public readonly syncTopic = $topic({
    name: "parameter:sync",
    schema: {
      payload: z.object({
        name: z.text(),
        instanceId: z.text(),
      }),
    },
    handler: async ({ payload }) => {
      await this.handleChangeNotification(payload as ParameterChangePayload);
    },
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a parameter primitive with the provider.
   * Computes and stores the schema hash.
   */
  public register(param: ParameterPrimitive<any>): void {
    this.primitives.set(param.name, param);
    this.schemaHashes.set(param.name, this.calculateSchemaHash(param.schema));
  }

  // ---------------------------------------------------------------------------
  // Public API used by $parameter primitive (thin delegates)
  // ---------------------------------------------------------------------------

  /**
   * Get the current parameter value asynchronously.
   * Lazy-loads from database on first call.
   * Checks if a cached next version has become current.
   */
  public async get(name: string): Promise<unknown> {
    const ck = this.cacheKey(name);
    if (!this.loaded.has(ck) || this.isStale(ck)) {
      if (!this.loadPromises.has(ck)) {
        // Clear in `finally`, not just on the success paths inside doLoad: a
        // rejected promise left in the map is re-awaited by every subsequent
        // get(), so one transient DB failure poisoned the parameter until
        // the process restarted.
        this.loadPromises.set(
          ck,
          this.doLoad(name).finally(() => this.loadPromises.delete(ck)),
        );
      }
      await this.loadPromises.get(ck);
    }

    // Check if cached next has become current
    const cachedNext = this.cachedNext.get(ck);
    if (cachedNext) {
      const now = this.dateTimeProvider.now().toDate();
      if (new Date(cachedNext.activationDate) <= now) {
        this.cachedCurrent.set(ck, cachedNext.content);
        this.cachedNext.delete(ck);
        this.reloadNextInBackground(name);
      }
    }

    const param = this.primitives.get(name);
    return this.cachedCurrent.has(ck)
      ? this.cachedCurrent.get(ck)
      : param?.options.default;
  }

  /**
   * Set a new parameter value.
   */
  public async set(
    name: string,
    value: unknown,
    options: SaveParameterOptions = {},
  ): Promise<void> {
    const schemaHash = this.schemaHashes.get(name) ?? "";

    await this.save(name, value as Record<string, unknown>, schemaHash, {
      activationDate: options.activationDate,
      changeDescription: options.changeDescription,
      tags: options.tags,
      creatorId: options.creatorId,
      creatorName: options.creatorName,
    });

    // Update local cache
    const ck = this.cacheKey(name);
    const now = this.dateTimeProvider.now().toDate();
    if (!options.activationDate || options.activationDate <= now) {
      const prev = this.cachedCurrent.get(ck);
      this.cachedCurrent.set(ck, value);
      if (JSON.stringify(prev) !== JSON.stringify(value)) {
        this.notifySubscribers(name);
      }
    } else {
      this.cachedNext.set(ck, {
        content: value,
        activationDate: options.activationDate.toISOString(),
      });
    }
    // The writer is by definition fresh — restart its revalidation window.
    this.loadedAt.set(ck, this.dateTimeProvider.nowMillis());
  }

  /** Whether the cached value outlived the revalidation TTL. */
  protected isStale(ck: string): boolean {
    const ttl = this.revalidateAfterMs;
    if (ttl <= 0) return false;
    const at = this.loadedAt.get(ck);
    return at === undefined
      ? true
      : this.dateTimeProvider.nowMillis() - at > ttl;
  }

  /**
   * Subscribe to parameter changes.
   * Returns an unsubscribe function.
   */
  public sub(name: string, fn: (v: unknown) => void): () => void {
    const ck = this.cacheKey(name);
    if (!this.subscribers.has(ck)) {
      this.subscribers.set(ck, []);
    }
    this.subscribers.get(ck)!.push(fn);
    return () => {
      const subs = this.subscribers.get(ck);
      if (subs) {
        const idx = subs.indexOf(fn);
        if (idx >= 0) {
          subs.splice(idx, 1);
        }
      }
    };
  }

  /**
   * Load current and next values from database.
   * Deduplicates concurrent calls via shared promise.
   */
  public async load(name: string): Promise<void> {
    const ck = this.cacheKey(name);
    // Same rule as `get()`: a failed load must not linger in the map.
    this.loadPromises.set(
      ck,
      this.doLoad(name).finally(() => this.loadPromises.delete(ck)),
    );
    await this.loadPromises.get(ck);
  }

  /**
   * Get the cached current content, falling back to default.
   * Synchronous access for admin API.
   */
  public getCachedCurrentContent(name: string): unknown {
    const ck = this.cacheKey(name);
    if (this.cachedCurrent.has(ck)) {
      return this.cachedCurrent.get(ck);
    }
    const param = this.primitives.get(name);
    return param?.options.default;
  }

  /**
   * Whether the parameter is using its default value (no DB value loaded).
   */
  public isUsingDefault(name: string): boolean {
    return !this.cachedCurrent.has(this.cacheKey(name));
  }

  // ---------------------------------------------------------------------------
  // Database operations
  // ---------------------------------------------------------------------------

  /**
   * Load the current and next parameter values from database.
   * Current: latest version with activationDate <= now.
   * Next: earliest version with activationDate > now.
   */
  public async loadCurrentAndNext(
    name: string,
  ): Promise<{ current: Parameter | null; next: Parameter | null; now: Date }> {
    const now = this.dateTimeProvider.now().toDate();
    const nowIso = now.toISOString();

    const [currentRows, nextRows] = await Promise.all([
      this.repo.findMany({
        where: { name, activationDate: { lte: nowIso } },
        orderBy: { column: "activationDate", direction: "desc" },
        limit: 2,
      }),
      this.repo.findMany({
        where: { name, activationDate: { gt: nowIso } },
        orderBy: { column: "activationDate", direction: "asc" },
        limit: 1,
      }),
    ]);

    // Secondary sort by version descending for same-millisecond ties
    const current =
      currentRows.length > 1 &&
      new Date(currentRows[0].activationDate).getTime() ===
        new Date(currentRows[1].activationDate).getTime()
        ? [...currentRows].sort((a, b) => b.version - a.version)[0]
        : (currentRows[0] ?? null);

    return {
      current: current ?? null,
      next: nextRows[0] ?? null,
      now,
    };
  }

  /**
   * Calculate statuses for a list of parameter versions.
   * Derives status from activationDate relative to now:
   * - The latest version with activationDate <= now is "current"
   * - The earliest version with activationDate > now is "next"
   * - Other future versions are "future"
   * - Other past versions are "expired"
   */
  public calculateStatuses<T extends Parameter>(
    versions: T[],
    now?: Date,
  ): Array<T & { status: ParameterStatus }> {
    const effectiveNow = now ?? this.dateTimeProvider.now().toDate();

    // Sort by activationDate ascending, then version ascending for ties
    const sorted = [...versions].sort((a, b) => {
      const timeDiff =
        new Date(a.activationDate).getTime() -
        new Date(b.activationDate).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.version - b.version;
    });

    // Find which should be current (latest activated)
    const pastVersions = sorted.filter(
      (v) => new Date(v.activationDate) <= effectiveNow,
    );
    const nextVersionCandidate = sorted.find(
      (v) => new Date(v.activationDate) > effectiveNow,
    );

    const currentVersion = pastVersions[pastVersions.length - 1];
    const nextVersion = nextVersionCandidate;

    return sorted.map((v) => {
      let status: ParameterStatus;
      if (currentVersion && v.id === currentVersion.id) {
        status = "current";
      } else if (nextVersion && v.id === nextVersion.id) {
        status = "next";
      } else if (new Date(v.activationDate) > effectiveNow) {
        status = "future";
      } else {
        status = "expired";
      }
      return { ...v, status };
    });
  }

  /**
   * Save a new parameter version.
   *
   * @param name - Parameter name (e.g., "app.features.flags")
   * @param content - New parameter content
   * @param schemaHash - Hash of the schema for migration detection
   * @param options - Additional options (activation date, creator info, etc.)
   */
  public async save<T extends ZObject>(
    name: string,
    content: Infer<T>,
    schemaHash: string,
    options: SaveParameterOptions = {},
  ): Promise<ParameterWithStatus> {
    // Resolve empty schema hash from registered primitive
    if (!schemaHash) {
      schemaHash = this.schemaHashes.get(name) ?? "";
    }

    // Validate content against the registered schema when the schema hash
    // matches. A mismatched hash means the content is from a different
    // schema version (e.g., migration seed) and should not be validated
    // against the current schema.
    const param = this.primitives.get(name);
    if (param && schemaHash === this.schemaHashes.get(name)) {
      content = this.alepha.codec.validate(param.schema, content) as Infer<T>;
    }

    const now = this.dateTimeProvider.now().toDate();
    const activationDate = options.activationDate ?? now;
    const isImmediate = activationDate <= now;

    // Get all versions to determine next version number and previous content
    const versions = await this.repo.findMany({
      where: { name },
      orderBy: { column: "version", direction: "desc" },
    });

    const latestVersion = versions[0];
    const newVersion = (latestVersion?.version ?? 0) + 1;

    // Find previous content from the latest activated version
    const currentVersion = versions.find(
      (v) => new Date(v.activationDate) <= now,
    );
    const previousContent = currentVersion?.content;

    // Check for schema migration
    let migrationLog: string | undefined;
    if (latestVersion && latestVersion.schemaHash !== schemaHash) {
      migrationLog = `Schema changed from ${latestVersion.schemaHash} to ${schemaHash} at version ${newVersion}`;
      this.log.info("Parameter schema migration detected", {
        name,
        migrationLog,
      });
    }

    // Insert new version
    const inserted = await this.repo.create({
      name,
      content: content as Record<string, unknown>,
      schemaHash,
      activationDate: activationDate.toISOString(),
      version: newVersion,
      changeDescription: options.changeDescription,
      tags: options.tags,
      creatorId: options.creatorId,
      creatorName: options.creatorName,
      previousContent: previousContent as Record<string, unknown> | undefined,
      migrationLog,
    });

    // Calculate status from existing versions + the newly inserted row
    const withStatuses = this.calculateStatuses([...versions, inserted]);
    const insertedWithStatus = withStatuses.find((v) => v.id === inserted.id)!;

    // Publish change notification if activation is immediate
    if (isImmediate) {
      await this.publishChange(name);
    }

    this.log.info("Parameter saved", {
      name,
      version: newVersion,
      status: insertedWithStatus.status,
    });

    return insertedWithStatus;
  }

  /**
   * Best-effort left join embedding the creating user on each version, so the
   * admin UI can render a human-readable identifier (live, not snapshotted)
   * instead of the bare `creatorId`. Joins `parameters.creatorId` → `users.id`.
   *
   * The `users` entity is resolved from the repository registry at runtime
   * rather than imported: that keeps the parameters module free of any
   * dependency on the users module (no import, no circular-import risk). When
   * the users module is not registered the join is skipped and `creator` comes
   * back undefined.
   */
  protected resolveCreatorJoin() {
    const usersEntity = this.repositoryProvider
      .getRepositories()
      .find((repo) => repo.entity.name === "users")?.entity;
    if (!usersEntity) {
      return undefined;
    }
    return {
      creator: {
        join: usersEntity,
        on: ["creatorId", usersEntity.cols.id] as [
          "creatorId",
          { name: string },
        ],
      },
    };
  }

  /**
   * Get all versions of a parameter, each with the creating user embedded
   * (best-effort, see {@link resolveCreatorJoin}).
   */
  public async getHistory(
    name: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Parameter[]> {
    const withCreator = this.resolveCreatorJoin();
    return this.repo.findMany({
      where: { name },
      orderBy: { column: "version", direction: "desc" },
      limit: options?.limit,
      offset: options?.offset,
      ...(withCreator ? { with: withCreator } : {}),
    });
  }

  /**
   * Delete all versions of a parameter.
   */
  public async delete(name: string): Promise<void> {
    await this.repo.deleteMany({ name: { eq: name } });
    this.evictCaches(name);
    // Evicting locally is not enough: other instances keep serving the
    // deleted value indefinitely (the Node default TTL is 0, so nothing
    // revalidates). `save()` already publishes — deletes must too.
    await this.publishChange(name);
    this.log.info("Parameter deleted", { name });
  }

  /**
   * Delete all versions of many parameters by name in one repository call.
   */
  public async deleteMany(names: string[]): Promise<string[]> {
    if (names.length === 0) return [];
    await this.repo.deleteMany({ name: { inArray: names } });
    for (const name of names) {
      this.evictCaches(name);
      await this.publishChange(name);
    }
    this.log.info("Parameters deleted", { count: names.length });
    return names;
  }

  /** Drop every per-org value cache entry for `name` in the active org. */
  protected evictCaches(name: string): void {
    const ck = this.cacheKey(name);
    this.cachedCurrent.delete(ck);
    this.cachedNext.delete(ck);
    this.loaded.delete(ck);
    this.loadPromises.delete(ck);
    this.loadGeneration.delete(ck);
    this.migrationChecked.delete(ck);
  }

  /**
   * Get a specific version of a parameter.
   */
  public async getVersion(
    name: string,
    version: number,
  ): Promise<Parameter | null> {
    const versions = await this.repo.findMany({
      where: { name, version },
    });
    return versions[0] ?? null;
  }

  /**
   * Get the version that was IN FORCE at `at` — the latest one whose
   * `activationDate` is at or before that instant.
   *
   * `get()` and {@link loadCurrentAndNext} are now-relative, which is wrong
   * for domains that price or decide against the time of an EVENT rather than
   * the time of the read: an event captured offline and uploaded hours later
   * must be evaluated with the parameters that were live when it happened,
   * not with whatever is live at ingest. Returns `null` when `at` predates
   * the first version.
   *
   * Deliberately NOT cached: the caller supplies an arbitrary instant, so the
   * per-name value caches (which model "now") do not apply. Reads hit the
   * `(organizationId, name, activationDate)` index.
   */
  public async getVersionAt(
    name: string,
    at: string | Date,
  ): Promise<Parameter | null> {
    const instant = (at instanceof Date ? at : new Date(at)).toISOString();
    const rows = await this.repo.findMany({
      where: { name, activationDate: { lte: instant } },
      orderBy: { column: "activationDate", direction: "desc" },
      limit: 2,
    });

    // Same-millisecond tie-break as loadCurrentAndNext: the highest version
    // wins, so two versions scheduled on the same instant resolve stably.
    if (
      rows.length > 1 &&
      new Date(rows[0].activationDate).getTime() ===
        new Date(rows[1].activationDate).getTime()
    ) {
      return [...rows].sort((a, b) => b.version - a.version)[0];
    }
    return rows[0] ?? null;
  }

  /**
   * Rollback to a previous version by creating a new version with old content.
   */
  public async rollback(
    name: string,
    targetVersion: number,
    options: SaveParameterOptions = {},
  ): Promise<ParameterWithStatus> {
    const target = await this.getVersion(name, targetVersion);

    if (!target) {
      throw new AlephaError(
        `Parameter version not found: ${name}@${targetVersion}`,
      );
    }

    return this.save(
      name,
      target.content as Infer<ZObject>,
      target.schemaHash,
      {
        ...options,
        changeDescription:
          options.changeDescription ?? `Rollback to version ${targetVersion}`,
      },
    );
  }

  /**
   * Get current parameter value with fallback to default from registered primitive.
   * Returns the in-memory current value which may be the default if never saved.
   */
  public getCurrentValue(
    name: string,
  ): { content: unknown; isDefault: boolean } | null {
    if (!this.primitives.has(name)) {
      return null;
    }
    return {
      content: this.getCachedCurrentContent(name),
      isDefault: this.isUsingDefault(name),
    };
  }

  /**
   * Get parameter info including current value with default fallback.
   *
   * When no version exists in the DB yet but a primitive is registered, this
   * lazily materializes v1 from the primitive's `default`. After this call,
   * the parameter has a concrete current row admins can edit / roll back /
   * compare against, instead of running on phantom defaults-from-code state.
   * Idempotent: subsequent calls return the same row without re-creating.
   */
  public async getCurrentWithDefault(name: string): Promise<{
    current: ParameterWithStatus | null;
    next: ParameterWithStatus | null;
    defaultValue: unknown;
    currentValue: unknown;
    schema: Record<string, unknown> | null;
    description: string | null;
  }> {
    let { current, next } = await this.loadCurrentAndNext(name);

    // Get default and current from registered primitive
    const param = this.primitives.get(name);

    // No version in DB yet but the primitive is registered: seed v1 from
    // the compiled defaults. Always-on parameters are then a tangible row
    // the admin UI can edit (and that history can grow from). Unregistered
    // names (orphans from a removed `$parameter`) are not seeded.
    if (!current && param) {
      try {
        current = await this.save(
          name,
          param.options.default as Infer<ZObject>,
          this.schemaHashes.get(name) ?? "",
          { changeDescription: "Auto-seeded from compiled defaults" },
        );
      } catch (err) {
        // A concurrent caller may have raced us to insert v1; fall back to
        // re-reading instead of bubbling up a unique-constraint error.
        this.log.warn("Auto-seed of parameter failed, retrying read", {
          name,
          error: (err as Error).message,
        });
        ({ current, next } = await this.loadCurrentAndNext(name));
      }
    }

    const defaultValue = param?.options.default ?? null;
    const currentValue = this.getCachedCurrentContent(name) ?? null;
    // Serialize the Zod schema to JSON Schema for transport. `param.schema` is a
    // live `ZodObject` instance, not a plain record, so it fails the response's
    // `z.json()` validation ("expected record, received ZodObject") and the
    // admin UI (which round-trips via `jsonSchemaToZod`) can't rebuild a form
    // from it. Typebox schemas were already JSON Schema, hence this step was
    // implicit before the Zod migration.
    const schema = param?.schema ? z.toJSONSchema(param.schema) : null;

    return {
      current: current ? { ...current, status: "current" as const } : null,
      next: next ? { ...next, status: "next" as const } : null,
      defaultValue,
      currentValue,
      schema,
      description: param?.options.description ?? null,
    };
  }

  /**
   * Get all unique parameter names (for tree view).
   */
  public async getParameterNames(): Promise<string[]> {
    const results = await this.repo.findMany({
      columns: ["name"],
      distinct: ["name"],
      orderBy: { column: "name", direction: "asc" },
    });

    return results.map((r) => r.name);
  }

  /**
   * Build a tree structure from parameter names for UI.
   * Includes both database parameters and registered (but not yet saved) parameters.
   */
  public async getParameterTree(): Promise<ParameterTreeNode[]> {
    const dbNames = await this.getParameterNames();
    const registeredNames = Array.from(this.primitives.keys());
    const allNames = [...new Set([...dbNames, ...registeredNames])].sort();
    return this.buildTree(allNames);
  }

  // ---------------------------------------------------------------------------
  // Internal: loading, migration, notification
  // ---------------------------------------------------------------------------

  /**
   * Internal load implementation.
   * Fetches current and next from database, updates cache.
   */
  protected async doLoad(name: string): Promise<void> {
    // Snapshot the org-scoped cache key at call time: the whole load runs in
    // one request context, so the atom (hence `ck`) is stable here.
    const ck = this.cacheKey(name);
    const gen = (this.loadGeneration.get(ck) ?? 0) + 1;
    this.loadGeneration.set(ck, gen);

    const { current, next } = await this.loadCurrentAndNext(name);
    const schemaHash = this.schemaHashes.get(name) ?? "";

    // Superseded by a newer load — discard results
    if (this.loadGeneration.get(ck) !== gen) return;

    // Check if migration is needed
    if (current && !this.migrationChecked.has(ck)) {
      this.migrationChecked.add(ck);
      const migration = this.migrateValue(
        name,
        current.content,
        current.schemaHash,
      );
      if (migration) {
        this.log.info("Auto-migrating parameter", {
          name,
          description: migration.description,
        });
        await this.save(
          name,
          migration.value as Record<string, unknown>,
          schemaHash,
          {
            changeDescription: migration.description,
          },
        );
        // Reload after migration to get the new current
        const updated = await this.loadCurrentAndNext(name);
        if (updated.current) {
          this.cachedCurrent.set(ck, updated.current.content);
        } else {
          this.cachedCurrent.delete(ck);
        }
        if (updated.next) {
          this.cachedNext.set(ck, {
            content: updated.next.content,
            activationDate: updated.next.activationDate,
          });
        } else {
          this.cachedNext.delete(ck);
        }
        this.loaded.add(ck);
        this.loadedAt.set(ck, this.dateTimeProvider.nowMillis());
        this.loadPromises.delete(ck);
        this.notifySubscribers(name);
        return;
      }
    }

    const prev = this.cachedCurrent.get(ck);
    const hadPrev = this.cachedCurrent.has(ck);
    if (current) {
      this.cachedCurrent.set(ck, current.content);
    } else {
      this.cachedCurrent.delete(ck);
    }
    if (next) {
      this.cachedNext.set(ck, {
        content: next.content,
        activationDate: next.activationDate,
      });
    } else {
      this.cachedNext.delete(ck);
    }
    this.loaded.add(ck);
    this.loadedAt.set(ck, this.dateTimeProvider.nowMillis());
    this.loadPromises.delete(ck);

    if (
      hadPrev &&
      JSON.stringify(prev) !== JSON.stringify(this.cachedCurrent.get(ck))
    ) {
      this.notifySubscribers(name);
    }
  }

  /**
   * Run migration with a distributed lock (Node.js only).
   * Ensures only one instance performs the migration while others wait.
   */
  protected async migrateWithLock(name: string): Promise<void> {
    const lockKey = `parameter:migrate:${name}`;
    const lockId = this.crypto.randomUUID();

    const value = await this.lockProvider.set(lockKey, lockId, true, 30_000);

    if (value === lockId) {
      // We got the lock — run migration
      try {
        await this.doLoad(name);
      } finally {
        await this.lockProvider.del(lockKey);
      }
    } else {
      // Another instance holds the lock — wait then load
      await this.waitForLock(lockKey);
      await this.doLoad(name);
    }
  }

  /**
   * Poll until a lock is released (or TTL expires).
   * Uses a probe-only SET NX with minimal TTL to detect release
   * without holding the lock longer than necessary.
   */
  protected async waitForLock(lockKey: string): Promise<void> {
    const maxWait = 30_000;
    const probeId = this.crypto.randomUUID();
    const start = this.dateTimeProvider.nowMillis();
    while (this.dateTimeProvider.nowMillis() - start < maxWait) {
      await this.dateTimeProvider.wait(500);
      const value = await this.lockProvider.set(lockKey, probeId, true, 500);
      if (value === probeId) {
        await this.lockProvider.del(lockKey);
        return;
      }
    }
  }

  /**
   * Attempt to migrate a DB value to the current schema.
   * Returns the migrated value if successful, or null if no migration needed.
   *
   * Cascade:
   * 1. Run user migrate() if provided
   * 2. Validate result against schema
   * 3. If invalid, shallow merge DB value with defaults
   * 4. Validate merged result
   * 5. If still invalid, use defaults
   */
  protected migrateValue(
    name: string,
    dbValue: unknown,
    dbSchemaHash: string,
  ): { value: unknown; description: string } | null {
    const schemaHash = this.schemaHashes.get(name) ?? "";
    const param = this.primitives.get(name);
    if (!param) {
      return null;
    }

    // No migration if schema hash matches
    if (dbSchemaHash === schemaHash) {
      return null;
    }

    const schema = param.schema;
    const defaults = param.options.default;

    // Step 1: Try user-provided migrate function
    if (param.options.migrate) {
      try {
        const migrated = param.options.migrate(dbValue);
        if (this.isValid(schema, migrated)) {
          if (JSON.stringify(migrated) === JSON.stringify(dbValue)) {
            return null;
          }
          return {
            value: migrated,
            description: "Auto-migrated: user migration function",
          };
        }
        this.log.warn(
          "Parameter migrate() returned invalid value, falling through to merge",
          { name },
        );
      } catch (err) {
        this.log.warn("Parameter migrate() threw, falling through to merge", {
          name,
          error: err,
        });
      }
    }

    // Step 2: Strip unknown keys and check if DB value is valid for new schema
    const schemaKeys = new Set(Object.keys(z.schema.shape(schema)));
    const stripped = this.pickSchemaKeys(
      dbValue as Record<string, unknown>,
      schemaKeys,
    );

    if (this.isValid(schema, stripped)) {
      if (JSON.stringify(stripped) === JSON.stringify(dbValue)) {
        return null;
      }
      return {
        value: stripped,
        description: "Auto-migrated: stripped unknown fields",
      };
    }

    // Step 3: Shallow merge DB value with defaults, keeping only schema keys
    const merged = this.pickSchemaKeys(
      Object.assign(
        {},
        defaults as Record<string, unknown>,
        dbValue as Record<string, unknown>,
      ),
      schemaKeys,
    );

    if (this.isValid(schema, merged)) {
      return {
        value: merged,
        description: "Auto-migrated: merged with defaults",
      };
    }

    // Step 4: Full reset to defaults
    return {
      value: defaults,
      description: "Auto-migrated: reset to defaults (schema incompatible)",
    };
  }

  /**
   * Reload next version info in background (non-blocking).
   */
  protected reloadNextInBackground(name: string): void {
    const ck = this.cacheKey(name);
    this.loadCurrentAndNext(name)
      .then(({ next }) => {
        if (next) {
          this.cachedNext.set(ck, {
            content: next.content,
            activationDate: next.activationDate,
          });
        } else {
          this.cachedNext.delete(ck);
        }
      })
      .catch((err) => {
        this.log.warn("Failed to reload next parameter version", {
          name,
          error: err,
        });
      });
  }

  /**
   * Notify all subscribers of a value change.
   */
  protected notifySubscribers(name: string): void {
    const ck = this.cacheKey(name);
    const subs = this.subscribers.get(ck);
    if (!subs) return;
    const param = this.primitives.get(name);
    const value = this.cachedCurrent.has(ck)
      ? this.cachedCurrent.get(ck)
      : param?.options.default;
    for (const fn of subs) {
      fn(value);
    }
  }

  /**
   * Probe whether a value matches the schema, without throwing or mutating.
   */
  protected isValid(schema: ZObject, value: unknown): boolean {
    try {
      this.schemaValidator.validate(schema, value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return a new object containing only keys present in the schema.
   */
  protected pickSchemaKeys(
    obj: Record<string, unknown>,
    schemaKeys: Set<string>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of schemaKeys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  /**
   * Calculate a hash of the schema for migration detection.
   * Uses CryptoProvider for proper SHA-256 hashing.
   */
  protected calculateSchemaHash(schema: ZObject): string {
    return this.crypto.hash(JSON.stringify(schema));
  }

  /**
   * Publish change notification to other instances.
   */
  protected async publishChange(name: string): Promise<void> {
    await this.syncTopic.publish({
      name,
      instanceId: this.instanceId,
    });
  }

  /**
   * Handle incoming change notification from other instances.
   * Reloads the parameter from DB.
   */
  protected async handleChangeNotification(
    payload: ParameterChangePayload,
  ): Promise<void> {
    // Ignore messages from self
    if (payload.instanceId === this.instanceId) {
      return;
    }

    if (!this.primitives.has(payload.name)) {
      return;
    }

    await this.load(payload.name);
  }

  /**
   * Build tree structure from dot-notation names.
   */
  protected buildTree(names: string[]): ParameterTreeNode[] {
    const root: ParameterTreeNode[] = [];

    for (const name of names) {
      const parts = name.split(".");
      let currentLevel = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        const path = parts.slice(0, i + 1).join(".");

        let existing = currentLevel.find((n) => n.name === part);

        if (!existing) {
          existing = {
            name: part,
            path,
            isLeaf,
            children: [],
          };
          currentLevel.push(existing);
        }

        if (isLeaf) {
          existing.isLeaf = true;
        }

        currentLevel = existing.children;
      }
    }

    return root;
  }
}

export interface SaveParameterOptions {
  activationDate?: Date;
  changeDescription?: string;
  tags?: string[];
  creatorId?: string;
  creatorName?: string;
}
