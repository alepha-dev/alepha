import { createHash, randomBytes } from "node:crypto";

import { $inject, Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  $repository,
  type Page,
  type PgQueryWhere,
  RepositoryProvider,
  sql,
} from "alepha/orm";
import type { IssuerResolver, UserInfo } from "alepha/security";
import {
  BadRequestError,
  ForbiddenError,
  type ServerRequest,
} from "alepha/server";

import { type ApiKeyEntity, apiKeyEntity } from "../entities/apiKeyEntity.ts";
import { ApiKeyParameters } from "../parameters/ApiKeyParameters.ts";
import type { AdminApiKeyResource } from "../schemas/adminApiKeyResourceSchema.ts";
import type { ApiKeyExpiresIn } from "../schemas/apiKeyExpiresInSchema.ts";
import type { ApiKeyStatus } from "../schemas/apiKeyStatusSchema.ts";

export class ApiKeyService {
  protected readonly alepha = $inject(Alepha);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly parameters = $inject(ApiKeyParameters);
  protected readonly repo = $repository(apiKeyEntity);
  protected readonly repositoryProvider = $inject(RepositoryProvider);

  /**
   * Cache validated API keys for 15 minutes.
   *
   * Pinned to per-isolate memory:
   * - The cache replaces a single indexed SELECT on `api_keys`. Routing it
   *   through a distributed K/V (KV/Redis) buys little — the SELECT is
   *   already cheap — and pinning to DB would actively trade one SQL read
   *   for another.
   * - Cold-start gives a fresh DB read on every new isolate, which is
   *   *better* for revocation visibility than a distributed cache that
   *   keeps serving stale entries until its own TTL.
   * - Avoids provisioning KV/Redis just for this one cache. Users who need
   *   cross-isolate sharing for high-throughput API auth can override
   *   globally via `alepha.with({ provide: CacheProvider, use: ... })`.
   */
  protected readonly validationCache = $cache<ApiKeyEntity | null, [string]>({
    provider: "memory",
    name: "api:keys:validation",
    ttl: [15, "minutes"],
  });

  /**
   * Bumped around every revocation so an in-flight validation can tell that
   * the row it just read is already stale.
   *
   * Invalidating the cache is not enough on its own: a validation that read
   * the key *before* the revocation still writes it back afterwards, and the
   * revoked key then authenticates until the 15-minute TTL expires. The
   * counter is per-isolate, exactly like the cache it guards.
   */
  protected revocationEpoch = 0;

  /**
   * When a usage write was last scheduled for each key, in this isolate.
   *
   * Consulted before `defer()` so a request inside the interval schedules
   * nothing at all. It cannot be the cached row's `lastUsedAt`: `$cache`
   * hands back a copy frozen at the moment the row was read, whose age only
   * grows, so a throttle reading it would write on every cache hit, which is
   * the write this exists to remove.
   *
   * Per-isolate, like the cache and the revocation epoch, so it needs no
   * invalidation: a cold isolate writes once and then throttles. An id only
   * lands here after its key validated, and the map is capped at
   * {@link maxUsageScheduleEntries}, dropping the least recently written.
   */
  protected readonly usageScheduledAt = new Map<string, number>();

  /**
   * How many keys {@link usageScheduledAt} remembers. Past it the least
   * recently written key is forgotten, which costs that key one early write.
   */
  protected readonly maxUsageScheduleEntries = 10_000;

  /**
   * Mark a revocation boundary. Called on both sides of the write so any
   * validation whose read spans it declines to cache its result.
   */
  protected markRevocation(): void {
    this.revocationEpoch++;
  }

  /**
   * Best-effort left join embedding the owner on every admin listing row, so
   * the UI can render `user.email` instead of the bare `userId`. Joins
   * `api_keys.userId` → `users.id`.
   *
   * The `users` entity is resolved from the repository registry at runtime
   * rather than imported — same pattern and same reason as
   * `FileService.resolveCreatorJoin`: the users module already depends on
   * this one (`$realm` wires the key resolver), so a compile-time import here
   * would form a circular dependency. Only applied when the `users` table is
   * actually registered, keeping the module usable standalone with a plain
   * `$issuer`.
   */
  protected resolveOwnerJoin() {
    const usersEntity = this.repositoryProvider
      .getRepositories()
      .find((repo) => repo.entity.name === "users")?.entity;
    if (!usersEntity) {
      return undefined;
    }
    return {
      user: {
        join: usersEntity,
        on: ["userId", usersEntity.cols.id] as ["userId", { name: string }],
      },
    };
  }

  /**
   * Days each expiry preset lives. A year is 365 days, so a cap of 365 admits
   * `"1y"` whatever the calendar says.
   */
  protected readonly expiryPresetDays: Record<
    Exclude<ApiKeyExpiresIn, "never">,
    number
  > = {
    "7d": 7,
    "30d": 30,
    "60d": 60,
    "90d": 90,
    "180d": 180,
    "1y": 365,
  };

  /**
   * Resolve the instant a key expires at, and enforce the expiry policy.
   *
   * Every path that sets a key's expiry goes through here (creation, and
   * rotation), and it lives in the service rather than a controller so that
   * `action.run()` and the MCP transport obey the same rule as HTTP.
   *
   * - `expiresIn` is resolved from the current time (`DateTimeProvider`).
   * - `expiresAt` is taken as given, for programmatic callers.
   * - Neither, or `"never"`, means no expiry: what every key got before the
   *   policy existed, so nothing changes while `maxExpiryDays` is `0`.
   *
   * Under `maxExpiryDays > 0`, an expiry past the cap, `"never"` and an
   * omitted expiry are all refused with a message naming the cap. Refused,
   * never clamped: a key silently shortened looks right when it is created and
   * stops working on a day nobody chose.
   */
  public resolveExpiresAt(input: {
    expiresIn?: ApiKeyExpiresIn;
    expiresAt?: Date;
  }): Date | undefined {
    if (input.expiresIn && input.expiresAt) {
      throw new BadRequestError("Pass either expiresIn or expiresAt, not both");
    }

    const maxDays = this.parameters.get("maxExpiryDays");
    const now = this.dateTimeProvider.nowMillis();
    const dayMillis = 24 * 60 * 60 * 1000;

    let expiresAt = input.expiresAt;
    if (input.expiresIn && input.expiresIn !== "never") {
      const days = this.expiryPresetDays[input.expiresIn];
      expiresAt = new Date(now + days * dayMillis);
    }

    if (maxDays === 0) {
      return expiresAt;
    }

    if (!expiresAt) {
      throw new BadRequestError(
        `API keys must expire within ${maxDays} days: a key without an expiry is not allowed`,
      );
    }

    if (expiresAt.getTime() > now + maxDays * dayMillis) {
      throw new BadRequestError(
        `API keys may not live longer than ${maxDays} days`,
      );
    }

    return expiresAt;
  }

  /**
   * Load a key by token hash. Extracted as a seam so the
   * validate-versus-revoke race can be driven deterministically in tests.
   */
  protected async findByTokenHash(hash: string): Promise<ApiKeyEntity | null> {
    return (
      (await this.repo.findOne({
        where: { tokenHash: { eq: hash } },
      })) ?? null
    );
  }

  // -------------------------------------------------------------------------
  // Resolver
  // -------------------------------------------------------------------------

  /**
   * Create an issuer resolver for API key authentication.
   * Lower priority means it runs before JWT resolver.
   *
   * @param options.priority - Priority of this resolver (default: 50, JWT is 100)
   * @param options.prefix - API key prefix to match in Bearer header (default: "ak")
   * @param options.resolveOwner - Called with the key's userId on every
   * validation. Return `undefined` (or `enabled: false`) to refuse the key —
   * so keys stop authenticating the moment their owner is disabled or
   * deleted; an API key must never outlive its account. The returned `roles`
   * cap the key's own stored roles, so a demoted owner's outstanding keys
   * lose the privileges they no longer hold.
   */
  public createResolver(
    options: {
      priority?: number;
      prefix?: string;
      resolveOwner?: (
        userId: string,
      ) => Promise<{ enabled: boolean; roles?: string[] } | undefined>;
    } = {},
  ): IssuerResolver {
    const { priority = 50, prefix = "ak" } = options;
    const prefixPattern = `${prefix}_`;

    return {
      priority,
      onRequest: async (req: ServerRequest) => {
        // Try query param first
        const url = typeof req.url === "string" ? new URL(req.url) : req.url;
        let token = url.searchParams.get("api_key");

        // Try Bearer header - only if token starts with expected prefix
        if (!token) {
          const auth = req.headers.authorization;
          if (auth?.startsWith("Bearer ")) {
            const bearerToken = auth.slice(7);
            if (bearerToken.startsWith(prefixPattern)) {
              token = bearerToken;
            }
          }
        }

        if (!token) {
          return null;
        }

        return this.validate(token, options.resolveOwner, req.ip);
      },
    };
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new API key for a user.
   * Returns both the API key entity and the plain token (which is only available once).
   *
   * The expiry is `expiresIn` or `expiresAt`, checked against the expiry
   * policy by {@link resolveExpiresAt}.
   */
  public async create(options: {
    userId: string;
    name: string;
    roles: string[];
    description?: string;
    expiresIn?: ApiKeyExpiresIn;
    expiresAt?: Date;
    prefix?: string;
  }): Promise<{ apiKey: ApiKeyEntity; token: string }> {
    const expiresAt = this.resolveExpiresAt(options);
    const prefix = options.prefix ?? "ak";
    const random = randomBytes(24).toString("base64url");
    const token = `${prefix}_${random}`;
    const hash = this.hashToken(token);
    const suffix = token.slice(-8);

    const apiKey = await this.repo.create({
      userId: options.userId,
      name: options.name,
      description: options.description,
      tokenHash: hash,
      tokenPrefix: prefix,
      tokenSuffix: suffix,
      roles: options.roles,
      expiresAt: expiresAt?.toISOString(),
    });

    this.log.info("API key created", {
      apiKeyId: apiKey.id,
      userId: options.userId,
      name: options.name,
    });

    return { apiKey, token };
  }

  /**
   * List every API key a user has, newest first, as {@link toView} shapes
   * them.
   *
   * ⚠️ Expired and revoked keys are included, each with its `status`, until
   * the purge job removes them. This used to return live keys only, so the key
   * that stopped working, the one a user comes looking for, could never be
   * shown. Anything that read the length of this list as a count of usable
   * keys now counts dead ones too: filter on `status`.
   */
  public async list(userId: string): Promise<AdminApiKeyResource[]> {
    const rows = await this.repo.findMany({
      where: { userId: { eq: userId } },
      orderBy: { column: "createdAt", direction: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Where a key is in its life. Derived, never stored (see
   * `apiKeyStatusSchema`). Revoked wins over expired.
   *
   * {@link statusWhere} is the same rule as a query; the two sit together so a
   * filter and a badge cannot disagree about a key an hour from its warning
   * window.
   */
  public statusOf(
    apiKey: Pick<ApiKeyEntity, "expiresAt" | "revokedAt">,
  ): ApiKeyStatus {
    if (apiKey.revokedAt) {
      return "revoked";
    }
    if (!apiKey.expiresAt) {
      return "active";
    }

    const now = this.dateTimeProvider.nowMillis();
    const expiresAt = new Date(apiKey.expiresAt).getTime();
    if (expiresAt <= now) {
      return "expired";
    }
    if (expiresAt <= this.warningUntil(now)) {
      return "expiring";
    }
    return "active";
  }

  /**
   * The `where` matching keys in any of these statuses: {@link statusOf} as a
   * query.
   *
   * With `expiryWarningDays: 0` nothing is `expiring`, so asking for it alone
   * matches no key at all.
   */
  public statusWhere(
    statuses: ApiKeyStatus[],
  ): PgQueryWhere<typeof apiKeyEntity.schema> {
    const now = this.dateTimeProvider.nowMillis();
    const nowIso = new Date(now).toISOString();
    const warningIso = new Date(this.warningUntil(now)).toISOString();

    const branches: Array<PgQueryWhere<typeof apiKeyEntity.schema>> = [];
    for (const status of new Set(statuses)) {
      switch (status) {
        case "revoked":
          branches.push({ revokedAt: { isNotNull: true } });
          break;
        case "expired":
          branches.push({
            revokedAt: { isNull: true },
            expiresAt: { lte: nowIso },
          });
          break;
        case "expiring":
          if (warningIso !== nowIso) {
            branches.push({
              revokedAt: { isNull: true },
              expiresAt: { gt: nowIso, lte: warningIso },
            });
          }
          break;
        case "active":
          branches.push({
            revokedAt: { isNull: true },
            or: [
              { expiresAt: { isNull: true } },
              { expiresAt: { gt: warningIso } },
            ],
          });
          break;
      }
    }

    if (branches.length === 0) {
      // A primary key is never null: the honest spelling of "no key".
      return { id: { isNull: true } };
    }
    return branches.length === 1 ? branches[0] : { or: branches };
  }

  /**
   * The end of the expiry warning window, from `now`.
   */
  protected warningUntil(now: number): number {
    const days = this.parameters.get("expiryWarningDays");
    return now + days * 24 * 60 * 60 * 1000;
  }

  /**
   * The one shape every read path returns: an explicit field list with the
   * derived `status`, and never `tokenHash`.
   *
   * Explicit rather than a spread of the row, so a column added to the entity
   * is published only when somebody adds it here, and the hash cannot ride
   * along on a transport whose response schema is not applied. The owner
   * summary the admin listing joins is carried when present.
   */
  public toView(
    apiKey: ApiKeyEntity & { user?: AdminApiKeyResource["user"] },
  ): AdminApiKeyResource {
    return {
      id: apiKey.id,
      userId: apiKey.userId,
      user: apiKey.user ?? undefined,
      name: apiKey.name,
      description: apiKey.description,
      tokenPrefix: apiKey.tokenPrefix,
      tokenSuffix: apiKey.tokenSuffix,
      roles: apiKey.roles,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      lastUsedIp: apiKey.lastUsedIp,
      expiresAt: apiKey.expiresAt,
      revokedAt: apiKey.revokedAt,
      usageCount: apiKey.usageCount,
      status: this.statusOf(apiKey),
    };
  }

  // -------------------------------------------------------------------------
  // Admin Operations
  // -------------------------------------------------------------------------

  /**
   * Find all API keys with optional filtering (admin only). Rows carry an
   * owner summary under `user` when the users table is registered — see
   * {@link resolveOwnerJoin}.
   *
   * Typed without `user` on purpose, like `FileService.findFiles`: the join
   * attaches it at runtime and the response schema declares it, while the
   * inferred type of a registry-resolved join is `Record<string, unknown>`,
   * which would conflict with the schema's shaped optional.
   */
  public async findAll(query: {
    userId?: string;
    includeRevoked?: boolean;
    page?: number;
    size?: number;
    sort?: string;
  }): Promise<Page<AdminApiKeyResource>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.userId) {
      where.userId = { eq: query.userId };
    }

    if (!query.includeRevoked) {
      where.revokedAt = { isNull: true };
    }

    const withOwner = this.resolveOwnerJoin();

    const page = await this.repo.paginate(
      query,
      { where, ...(withOwner ? { with: withOwner } : {}) },
      { count: true },
    );

    // The registry-resolved join types `user` as `Record<string, unknown>`;
    // at runtime it is the owner row or absent (see the note above).
    return {
      ...page,
      content: page.content.map((row) =>
        this.toView(
          row as ApiKeyEntity & { user?: AdminApiKeyResource["user"] },
        ),
      ),
    };
  }

  /**
   * Get an API key by ID (admin only).
   */
  public async getById(id: string): Promise<AdminApiKeyResource> {
    return this.toView(await this.repo.getById(id));
  }

  /**
   * Revoke any API key (admin only).
   */
  public async revokeByAdmin(id: string): Promise<void> {
    const apiKey = await this.repo.getById(id);

    if (apiKey.revokedAt) {
      return; // Already revoked
    }

    this.markRevocation();
    await this.validationCache.invalidate(apiKey.tokenHash);

    await this.repo.updateById(id, {
      revokedAt: this.dateTimeProvider.now().toISOString(),
    });

    this.markRevocation();
    await this.validationCache.invalidate(apiKey.tokenHash);

    this.log.info("API key revoked by admin", {
      apiKeyId: id,
      userId: apiKey.userId,
    });
  }

  /**
   * Revoke many API keys in one repository call (admin only). Already-revoked
   * keys are silently skipped. Returns the ids that were actually revoked.
   */
  public async revokeManyByAdmin(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const keys = await this.repo.findMany({
      where: { id: { inArray: ids } },
      columns: ["id", "tokenHash", "revokedAt"],
    });
    const toRevoke = keys.filter((k) => !k.revokedAt);
    if (toRevoke.length === 0) return [];

    this.markRevocation();
    await Promise.all(
      toRevoke.map((k) => this.validationCache.invalidate(k.tokenHash)),
    );

    await this.repo.updateMany(
      { id: { inArray: toRevoke.map((k) => k.id) } },
      {
        revokedAt: this.dateTimeProvider.now().toISOString(),
      },
    );

    this.markRevocation();
    await Promise.all(
      toRevoke.map((k) => this.validationCache.invalidate(k.tokenHash)),
    );

    this.log.info("API keys revoked by admin", { count: toRevoke.length });
    return toRevoke.map((k) => k.id);
  }

  // -------------------------------------------------------------------------
  // User Operations
  // -------------------------------------------------------------------------

  /**
   * Revoke an API key. Only the owner can revoke their own keys.
   */
  public async revoke(id: string, userId: string): Promise<void> {
    const apiKey = await this.repo.getById(id);

    if (apiKey.userId !== userId) {
      throw new ForbiddenError("Not your API key");
    }

    // Already revoked: a second revocation would move `revokedAt`, and with it
    // the purge window measured from it.
    if (apiKey.revokedAt) {
      return;
    }

    this.markRevocation();
    await this.validationCache.invalidate(apiKey.tokenHash);

    await this.repo.updateById(id, {
      revokedAt: this.dateTimeProvider.now().toISOString(),
    });

    this.markRevocation();
    await this.validationCache.invalidate(apiKey.tokenHash);

    this.log.info("API key revoked", {
      apiKeyId: id,
      userId,
    });
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate an API key token and return user info if valid.
   *
   * @param resolveOwner - Optional per-request owner check; a false return
   * refuses the key (owner disabled or deleted).
   * @param ip - The client address of the request being authenticated,
   * recorded as the key's `lastUsedIp`. Pass it whenever the request is at
   * hand: the issuer resolver runs in `server:onRequest`, before the router
   * stores the request, so the fallback (the stored request's IP) only
   * reaches a caller inside a route handler.
   */
  public async validate(
    token: string,
    resolveOwner?: (
      userId: string,
    ) => Promise<{ enabled: boolean; roles?: string[] } | undefined>,
    ip?: string,
  ): Promise<UserInfo | null> {
    // Quick check for API key format
    if (!token.includes("_")) {
      return null;
    }

    const hash = this.hashToken(token);

    // Try cache first
    let apiKey = await this.validationCache.get(hash);

    // If not in cache, look up in database
    if (apiKey === undefined) {
      // Snapshot BEFORE the read: if a revocation lands while this query is
      // in flight, the row we get back is already stale and must not be
      // cached. `invalidate()` alone could not prevent that — it runs before
      // our `set`, so the write simply resurrected the pre-revocation row and
      // the revoked key kept authenticating for the full 15-minute TTL.
      const epoch = this.revocationEpoch;

      apiKey = await this.findByTokenHash(hash);

      // Store in cache (even if null, to prevent repeated lookups)
      if (epoch === this.revocationEpoch) {
        await this.validationCache.set(hash, apiKey);
      }
    }

    if (!apiKey) {
      return null;
    }

    // Check revocation
    if (apiKey.revokedAt) {
      return null;
    }

    // Check expiration
    if (
      apiKey.expiresAt &&
      this.dateTimeProvider.now().isAfter(apiKey.expiresAt)
    ) {
      return null;
    }

    // A key must never outlive its account: refuse when the owner is
    // disabled or deleted. Deliberately NOT cached — revocation must be
    // visible immediately.
    let roles = apiKey.roles;
    if (resolveOwner) {
      const owner = await resolveOwner(apiKey.userId);
      if (!owner?.enabled) {
        this.log.info("API key refused: owner is disabled or deleted", {
          apiKeyId: apiKey.id,
          userId: apiKey.userId,
        });
        return null;
      }

      // Cap the key's stored roles by what the owner holds *now*. The stored
      // set is a snapshot from creation time, so without this a key minted
      // while its owner was an admin keeps granting admin after they are
      // demoted — making demotion meaningless while any key is outstanding.
      // Intersecting (rather than replacing) preserves least privilege: a
      // deliberately narrow key never widens when its owner is promoted.
      if (owner.roles) {
        const live = new Set(owner.roles);
        roles = roles.filter((role) => live.has(role));
      }
    }

    // Record usage without holding up the request. The provider keeps the
    // write alive past the response on Workers (`waitUntil`), flushes it on
    // stop, and logs a failure. The IP is resolved now, so the deferred task
    // depends on nothing but its arguments. The caller's `ip` comes first:
    // the store holds no request yet when the resolver calls this.
    //
    // Throttled to one write per key per `usageWriteIntervalMinutes`, decided
    // here rather than inside `updateUsage`, so a throttled request hands the
    // provider (and `waitUntil`) nothing.
    if (this.shouldRecordUsage(apiKey.id)) {
      const clientIp = ip ?? this.alepha.store.get("alepha.http.request")?.ip;
      this.background.defer(() => this.updateUsage(apiKey.id, clientIp));
    }

    // The marker is what tells every route downstream that this identity is
    // a machine credential and not a signed-in session.
    return {
      id: apiKey.userId,
      roles,
      credential: { type: "api-key", id: apiKey.id },
    };
  }

  /**
   * Whether this validation schedules a usage write, recording the moment
   * when it does.
   *
   * Recorded when the write is scheduled, not when it finishes: a write that
   * fails then suppresses the next one for an interval, which is the right
   * trade for an approximate counter and keeps completion out of the map.
   * `usageWriteIntervalMinutes: 0` writes on every call, as before.
   */
  protected shouldRecordUsage(apiKeyId: string): boolean {
    const intervalMinutes = this.parameters.get("usageWriteIntervalMinutes");
    if (intervalMinutes === 0) {
      return true;
    }

    const now = this.dateTimeProvider.nowMillis();
    const last = this.usageScheduledAt.get(apiKeyId);
    if (last !== undefined && now - last < intervalMinutes * 60 * 1000) {
      return false;
    }

    // Re-inserted so the Map's insertion order is least recently written
    // first, which is what the cap below evicts.
    this.usageScheduledAt.delete(apiKeyId);
    this.usageScheduledAt.set(apiKeyId, now);
    if (this.usageScheduledAt.size > this.maxUsageScheduleEntries) {
      const oldest = this.usageScheduledAt.keys().next();
      if (!oldest.done) {
        this.usageScheduledAt.delete(oldest.value);
      }
    }

    return true;
  }

  /**
   * Update usage statistics for an API key.
   *
   * An IP the column cannot hold is not written, and the row keeps the one it
   * had. Under `TRUST_PROXY` (the default) it can come verbatim from a header
   * the client sets, and a value the column refuses fails the whole write, so
   * one oversized `X-Real-IP` would hide the key's `lastUsedAt` and
   * `usageCount`.
   */
  protected async updateUsage(id: string, ip?: string): Promise<void> {
    const ipFits = apiKeyEntity.schema.shape.lastUsedIp.safeParse(ip).success;

    await this.repo.updateById(id, {
      lastUsedAt: this.dateTimeProvider.now().toISOString(),
      lastUsedIp: ipFits ? ip : undefined,
      usageCount: sql`${this.repo.table.usageCount} + 1`,
    });
  }

  /**
   * Hash a token using SHA-256.
   */
  protected hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
