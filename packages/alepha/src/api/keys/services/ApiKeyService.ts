import { createHash, randomBytes } from "node:crypto";
import { $inject, Alepha } from "alepha";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, sql } from "alepha/orm";
import type { IssuerResolver, UserInfo } from "alepha/security";
import { ForbiddenError, type ServerRequest } from "alepha/server";
import { type ApiKeyEntity, apiKeyEntity } from "../entities/apiKeyEntity.ts";

export class ApiKeyService {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly repo = $repository(apiKeyEntity);

  /**
   * Cache validated API keys for 15 minutes.
   */
  protected readonly validationCache = $cache<ApiKeyEntity | null, [string]>({
    name: "api:keys:validation",
    ttl: [15, "minutes"],
  });

  // -------------------------------------------------------------------------
  // Resolver
  // -------------------------------------------------------------------------

  /**
   * Create an issuer resolver for API key authentication.
   * Lower priority means it runs before JWT resolver.
   *
   * @param options.priority - Priority of this resolver (default: 50, JWT is 100)
   * @param options.prefix - API key prefix to match in Bearer header (default: "ak")
   */
  public createResolver(
    options: { priority?: number; prefix?: string } = {},
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

        return this.validate(token);
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
   * Find all API keys with optional filtering (admin only).
   */
  public async findAll(query: {
    userId?: string;
    includeRevoked?: boolean;
    page?: number;
    size?: number;
    sort?: string;
  }) {
    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.userId) {
      where.userId = { eq: query.userId };
    }

    if (!query.includeRevoked) {
      where.revokedAt = { isNull: true };
    }

    return this.repo.paginate(query, { where }, { count: true });
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

    // Invalidate cache
    await this.validationCache.invalidate(apiKey.tokenHash);

    await this.repo.updateById(id, {
      revokedAt: this.dateTimeProvider.now().toISOString(),
    });

    this.log.info("API key revoked by admin", {
      apiKeyId: id,
      userId: apiKey.userId,
    });
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

    await this.validationCache.invalidate(apiKey.tokenHash);

    await this.repo.updateById(id, {
      revokedAt: this.dateTimeProvider.now().toISOString(),
    });

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
   */
  public async validate(token: string): Promise<UserInfo | null> {
    // Quick check for API key format
    if (!token.includes("_")) {
      return null;
    }

    const hash = this.hashToken(token);

    // Try cache first
    let apiKey = await this.validationCache.get(hash);

    // If not in cache, look up in database
    if (apiKey === undefined) {
      apiKey =
        (await this.repo.findOne({
          where: { tokenHash: { eq: hash } },
        })) ?? null;

      // Store in cache (even if null, to prevent repeated lookups)
      await this.validationCache.set(hash, apiKey);
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

    // Update usage stats (fire and forget)
    this.updateUsage(apiKey.id).catch((error) => {
      this.log.warn("Failed to update API key usage", { error });
    });

    return {
      id: apiKey.userId,
      roles: apiKey.roles,
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
