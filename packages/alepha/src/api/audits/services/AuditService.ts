import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import type { ServerRequest } from "alepha/server";
import {
  type AuditEntity,
  type AuditSeverity,
  audits,
} from "../entities/audits.ts";
import type { AuditQuery } from "../schemas/auditQuerySchema.ts";
import type { CreateAudit } from "../schemas/createAuditSchema.ts";

/**
 * Registered audit type definition.
 */
export interface AuditTypeDefinition {
  type: string;
  description?: string;
  actions: string[];
}

/**
 * Service for managing audit logs.
 *
 * Provides methods for:
 * - Creating audit entries
 * - Querying audit history
 * - Aggregating audit statistics
 * - Managing registered audit types
 */
export class AuditService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly repo = $repository(audits);

  /**
   * Registry of audit types and their allowed actions.
   */
  protected readonly auditTypes = new Map<string, AuditTypeDefinition>();

  /**
   * Register an audit type with its allowed actions.
   */
  public registerType(definition: AuditTypeDefinition): void {
    this.auditTypes.set(definition.type, definition);
    this.log.debug("Audit type registered", {
      type: definition.type,
      actions: definition.actions,
    });
  }

  /**
   * Get all registered audit types.
   */
  public getRegisteredTypes(): AuditTypeDefinition[] {
    return Array.from(this.auditTypes.values());
  }

  /**
   * Distinct action names across all registered audit types, sorted.
   *
   * Sourced from the `$audit` type registry. Audit types register lazily —
   * when their holder (e.g. `SessionAudits`, `ParameterAudits`) is first
   * injected — so the admin filter only lists actions for audit domains that
   * are actually in use, which is the intended behaviour.
   */
  public getDistinctActions(): string[] {
    return [
      ...new Set(this.getRegisteredTypes().flatMap((type) => type.actions)),
    ].sort();
  }

  /**
   * Get current request context if available.
   */
  protected getRequestContext(): ServerRequest | undefined {
    return this.alepha.store.get("alepha.http.request");
  }

  /**
   * Create a new audit log entry.
   * Automatically populates ipAddress, userAgent, and requestId from the current request context.
   */
  public async create(data: CreateAudit): Promise<AuditEntity> {
    const request = this.getRequestContext();

    // Auto-populate from request context if not provided
    const contextData: Partial<CreateAudit> = {};

    if (request) {
      if (!data.ipAddress && request.ip) {
        contextData.ipAddress = request.ip;
      }
      if (!data.userAgent && request.headers["user-agent"]) {
        contextData.userAgent = request.headers["user-agent"];
      }
      if (!data.requestId && request.requestId) {
        contextData.requestId = request.requestId;
      }
      // Check for session in metadata
      if (!data.sessionId && request.metadata?.sessionId) {
        contextData.sessionId = request.metadata.sessionId;
      }
      // Extract user from request.user (set by ServerSecurityProvider)
      const user = request.user;
      if (user) {
        if (!data.userId && user.id) {
          contextData.userId = user.id;
        }
        if (!data.userEmail && user.email) {
          contextData.userEmail = user.email;
        }
        if (!data.userRealm && user.realm) {
          contextData.userRealm = user.realm;
        }
      }
    }

    this.log.trace("Creating audit entry", {
      type: data.type,
      action: data.action,
      userId: data.userId ?? contextData.userId,
    });

    const success = data.success ?? true;
    const entry = await this.repo.create({
      ...contextData,
      ...data,
      // Outcome drives severity: a failed audit (success:false) defaults to
      // `warning`, otherwise `info`. Explicit `severity` always wins. This is
      // the single place the OK/Failed → severity rule lives, so holders and
      // `$audit` primitives don't repeat it.
      severity: data.severity ?? (success ? "info" : "warning"),
      success,
    });

    this.log.debug("Audit entry created", {
      id: entry.id,
      type: data.type,
      action: data.action,
    });

    return entry;
  }

  /**
   * Record an audit event (convenience method).
   */
  public async record(
    type: string,
    action: string,
    options: Omit<CreateAudit, "type" | "action"> = {},
  ): Promise<AuditEntity> {
    return this.create({ type, action, ...options });
  }

  /**
   * Find audit entries with filtering and pagination.
   */
  public async find(query: AuditQuery = {}): Promise<Page<AuditEntity>> {
    this.log.trace("Finding audit entries", { query });

    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    if (query.type) {
      where.type = { eq: query.type };
    }

    if (query.action) {
      where.action = { eq: query.action };
    }

    if (query.severity) {
      where.severity = { eq: query.severity };
    }

    if (query.userId) {
      where.userId = { eq: query.userId };
    }

    if (query.userRealm) {
      where.userRealm = { eq: query.userRealm };
    }

    if (query.resourceType) {
      where.resourceType = { eq: query.resourceType };
    }

    if (query.resourceId) {
      where.resourceId = { eq: query.resourceId };
    }

    if (query.success !== undefined) {
      where.success = { eq: query.success };
    }

    if (query.from) {
      where.createdAt = { ...(where.createdAt as object), gte: query.from };
    }

    if (query.to) {
      where.createdAt = { ...(where.createdAt as object), lte: query.to };
    }

    if (query.search) {
      where.description = { like: `%${query.search}%` };
    }

    const result = await this.repo.paginate(query, { where }, { count: true });

    this.log.debug("Audit entries found", {
      count: result.content.length,
      total: result.page.totalElements,
    });

    return result;
  }

  /**
   * Get audit entry by ID.
   */
  public async getById(id: string): Promise<AuditEntity> {
    return this.repo.getById(id);
  }

  /**
   * Get audit entries for a specific user.
   */
  public async findByUser(
    userId: string,
    query: Omit<AuditQuery, "userId"> = {},
  ): Promise<Page<AuditEntity>> {
    return this.find({ ...query, userId });
  }

  /**
   * Get audit entries for a specific resource.
   */
  public async findByResource(
    resourceType: string,
    resourceId: string,
    query: Omit<AuditQuery, "resourceType" | "resourceId"> = {},
  ): Promise<Page<AuditEntity>> {
    return this.find({ ...query, resourceType, resourceId });
  }

  /**
   * Get audit statistics for a time period.
   */
  public async getStats(
    options: { from?: Date; to?: Date; userRealm?: string } = {},
  ): Promise<AuditStats> {
    this.log.trace("Getting audit stats", options);

    const where = this.repo.createQueryWhere();

    if (options.from) {
      where.createdAt = { gte: options.from.toISOString() };
    }

    if (options.to) {
      where.createdAt = {
        ...(where.createdAt as object),
        lte: options.to.toISOString(),
      };
    }

    if (options.userRealm) {
      where.userRealm = { eq: options.userRealm };
    }

    const all = await this.repo.findMany({ where });

    const stats: AuditStats = {
      total: all.length,
      byType: {},
      bySeverity: { info: 0, warning: 0, critical: 0 },
      successRate: 0,
      recentFailures: [],
    };

    let successCount = 0;

    for (const entry of all) {
      // Count by type
      stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;

      // Count by severity
      const severity = entry.severity as AuditSeverity;
      stats.bySeverity[severity]++;

      // Count successes
      if (entry.success) {
        successCount++;
      }
    }

    stats.successRate = stats.total > 0 ? successCount / stats.total : 1;

    // Get recent failures
    const failures = all
      .filter((e) => !e.success)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);

    stats.recentFailures = failures;

    return stats;
  }

  /**
   * Delete old audit entries (for retention policy).
   */
  public async deleteOlderThan(date: Date): Promise<number> {
    this.log.info("Deleting old audit entries", { olderThan: date });

    const old = await this.repo.findMany({
      where: { createdAt: { lt: date.toISOString() } },
    });

    for (const entry of old) {
      await this.repo.deleteById(entry.id);
    }

    this.log.info("Old audit entries deleted", { count: old.length });

    return old.length;
  }
}

/**
 * Audit statistics summary.
 */
export interface AuditStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<AuditSeverity, number>;
  successRate: number;
  recentFailures: AuditEntity[];
}
