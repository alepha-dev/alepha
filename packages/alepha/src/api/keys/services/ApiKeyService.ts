import { createHash, randomBytes } from "node:crypto";

import { $inject, Alepha } from "alepha";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page, RepositoryProvider, sql } from "alepha/orm";
import type { IssuerResolver, UserInfo } from "alepha/security";
import { ForbiddenError, type ServerRequest } from "alepha/server";

import { type ApiKeyEntity, apiKeyEntity } from "../entities/apiKeyEntity.ts";

export class ApiKeyService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
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

        return this.validate(token, options.resolveOwner);
      },
    };
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new API key for a user.
   * Returns both the API key entity and the plain token (which is only available once).
   */
  public async create(options: {
    userId: string;
    name: string;
    roles: string[];
    description?: string;
    expiresAt?: Date;
    prefix?: string;
  }): Promise<{ apiKey: ApiKeyEntity; token: string }> {
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
      expiresAt: options.expiresAt?.toISOString(),
    });

    this.log.info("API key created", {
      apiKeyId: apiKey.id,
      userId: options.userId,
      name: options.name,
    });

    return { apiKey, token };
  }

  /**
   * List all non-revoked API keys for a user.
   */
  public async list(userId: string): Promise<ApiKeyEntity[]> {
    return this.repo.findMany({
      where: {
        userId: { eq: userId },
        revokedAt: { isNull: true },
      },
      orderBy: { column: "createdAt", direction: "desc" },
    });
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
  }): Promise<Page<ApiKeyEntity>> {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.userId) {
      where.userId = { eq: query.userId };
    }

    if (!query.includeRevoked) {
      where.revokedAt = { isNull: true };
    }

    const withOwner = this.resolveOwnerJoin();

    return this.repo.paginate(
      query,
      { where, ...(withOwner ? { with: withOwner } : {}) },
      { count: true },
    );
  }

  /**
   * Get an API key by ID (admin only).
   */
  public async getById(id: string): Promise<ApiKeyEntity> {
    return await this.repo.getById(id);
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
   * @param validateOwner - Optional per-request owner check; a false return
   * refuses the key (owner disabled or deleted).
   */
  public async validate(
    token: string,
    resolveOwner?: (
      userId: string,
    ) => Promise<{ enabled: boolean; roles?: string[] } | undefined>,
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

    // Update usage stats (fire and forget)
    this.updateUsage(apiKey.id).catch((error) => {
      this.log.warn("Failed to update API key usage", { error });
    });

    return {
      id: apiKey.userId,
      roles,
    };
  }

  /**
   * Update usage statistics for an API key.
   */
  protected async updateUsage(id: string): Promise<void> {
    const request = this.alepha.store.get("alepha.http.request");

    await this.repo.updateById(id, {
      lastUsedAt: this.dateTimeProvider.now().toISOString(),
      lastUsedIp: request?.ip,
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
