import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";
import type { ServerRequest } from "alepha/server";

import {
  type AuditEntity,
  type AuditSeverity,
  audits,
} from "../entities/audits.ts";
import type { AuditActionPair } from "../schemas/auditActionPairSchema.ts";
import type { AuditQuery } from "../schemas/auditQuerySchema.ts";
import type { CreateAudit } from "../schemas/createAuditSchema.ts";

/**
 * Registered audit type definition.
 */
export interface AuditTypeDefinition {
  type: string;
  description?: string;
  actions: string[];

  /**
   * Dedicated retention (in days) for this audit type.
   *
   * Overrides the global default applied by the cleanup job. `0` keeps entries
   * forever. When `undefined`, the global default retention applies.
   */
  retentionDays?: number;

  /**
   * Which actions merge into one row, and how close together they have to be.
   * See `$audit`'s `coalesce`.
   */
  coalesce?: { actions: string[]; window: string };

  /**
   * {@link coalesce}'s window, in milliseconds, parsed once at registration.
   *
   * Kept beside the raw spec rather than replacing it so `getRegisteredTypes`
   * still answers what was declared, and so the parse happens at boot instead
   * of on every write.
   */
  coalesceWindowMs?: number;
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
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Registry of audit types and their allowed actions.
   */
  protected readonly auditTypes = new Map<string, AuditTypeDefinition>();

  /**
   * Register an audit type with its allowed actions.
   */
  public registerType(definition: AuditTypeDefinition): void {
    if (definition.coalesce) {
      // A subset of the declared actions, checked the way `log()` checks its
      // argument: a typo here would otherwise be a rule that silently never
      // fires, which is the worst kind to debug.
      const unknown = definition.coalesce.actions.filter(
        (action) => !definition.actions.includes(action),
      );
      if (unknown.length > 0) {
        throw new AlephaError(
          `Audit type '${definition.type}' coalesces unknown action(s) ${unknown.join(", ")}. Declared actions: ${definition.actions.join(", ")}.`,
        );
      }
      definition.coalesceWindowMs = this.parseWindow(
        definition.coalesce.window,
        definition.type,
      );
    }
    this.auditTypes.set(definition.type, definition);
    this.log.debug("Audit type registered", {
      type: definition.type,
      actions: definition.actions,
    });
  }

  /**
   * Parse a coalescing window into milliseconds.
   *
   * Seconds, minutes and hours only. A window measured in days would be a row
   * standing for a whole day of edits while sitting at that day's start
   * position in a feed sorted by `createdAt`, which is the failure the
   * measured-from-`createdAt` rule exists to avoid.
   */
  protected parseWindow(spec: string, type: string): number {
    const match = /^(\d+)([smh])$/.exec(spec);
    if (!match) {
      throw new AlephaError(
        `Audit type '${type}' declares a malformed coalescing window '${spec}'; expected a count of seconds, minutes or hours such as '5m'.`,
      );
    }
    const scale = { s: 1_000, m: 60_000, h: 3_600_000 }[match[2]] ?? 0;
    return Number(match[1]) * scale;
  }

  /**
   * Get all registered audit types.
   */
  public getRegisteredTypes(): AuditTypeDefinition[] {
    return Array.from(this.auditTypes.values());
  }

  /**
   * Every `(type, action)` pair the registered audit types declare, sorted by
   * type then action.
   *
   * Pairs rather than bare action names: an action only means something
   * inside its type. `create` is a user in one row and a parameter version in
   * another, and a filter offering the bare name selected every type's
   * `create` at once while collapsing them into one entry (feedback #2049).
   * The pair is what an audit row is identified by, so it is what the filter
   * offers.
   *
   * Sourced from the `$audit` type registry. Audit types register lazily —
   * when their holder (e.g. `SessionAudits`, `ParameterAudits`) is first
   * injected — so the admin filter only lists actions for audit domains that
   * are actually in use, which is the intended behaviour.
   */
  public getDistinctActions(): AuditActionPair[] {
    const pairs = new Map<string, AuditActionPair>();
    for (const type of this.getRegisteredTypes()) {
      for (const action of type.actions) {
        pairs.set(JSON.stringify([type.type, action]), {
          type: type.type,
          action,
        });
      }
    }
    return [...pairs.values()].sort(
      (a, b) =>
        a.type.localeCompare(b.type) || a.action.localeCompare(b.action),
    );
  }

  /**
   * Distinct `resourceType` / `userRealm` values present in the audit log.
   *
   * Read from the rows rather than a hardcoded list: the set of resource types
   * an app audits is app-specific, and the realms in play depend on the
   * deployment. Nulls are dropped — an audit entry without a resource type is
   * not a filterable value.
   */
  public async getDistinctFilterValues(): Promise<{
    resourceTypes: string[];
    userRealms: string[];
  }> {
    const [resourceTypes, userRealms] = await Promise.all([
      this.repo.findMany({ distinct: ["resourceType"] }),
      this.repo.findMany({ distinct: ["userRealm"] }),
    ]);

    const values = (rows: Array<Record<string, unknown>>, column: string) =>
      rows
        .map((row) => row[column])
        .filter(
          (value): value is string => typeof value === "string" && !!value,
        )
        .sort();

    return {
      resourceTypes: values(resourceTypes, "resourceType"),
      userRealms: values(userRealms, "userRealm"),
    };
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

    // A burst of identical events folds into the row it started, if the type
    // asked for it. Everything below this line is unchanged for a type that
    // did not: `coalesceInto` returns undefined without touching the database.
    const merged = await this.coalesceInto(
      { ...contextData, ...data },
      success,
    );
    if (merged) {
      return merged;
    }

    const entry = await this.repo.create({
      ...contextData,
      ...data,
      // Clamped, because an audit row must never be the thing that fails the
      // action it is recording.
      //
      // Both columns are `z.text()`, which carries a 255-character cap. The
      // values that land in them come from the audited domain and are not
      // bounded by it: Lore writes a quest's title into `description`, and a
      // quest title has no maximum. Unclamped, creating a quest with a
      // 300-character title would fail schema validation on the audit insert
      // and - since call sites await this inside their own transaction - roll
      // back the quest itself. The record is worth having truncated; it is not
      // worth breaking the write.
      description: this.clamp(data.description),
      errorMessage: this.clamp(data.errorMessage),
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
   * Fold this event into an open row, or answer `undefined` to let the caller
   * insert.
   *
   * ## What makes two events the same event
   *
   * `(scopeType, scopeId, type, action, userId, resourceType, resourceId)`,
   * plus `success`. Anything else differing - a different actor, a different
   * resource, a failure among successes - is a different fact and gets its own
   * row.
   *
   * ## The window is measured from `createdAt`
   *
   * Not from the row's last event. That bounds a row's span to the window, so
   * its position in a feed sorted by `createdAt desc` is off by at most that
   * much, and it keeps this lookup a plain range the composite indexes serve
   * as a seek: `(scopeType, scopeId, type, action, createdAt)` for scoped
   * rows, `(type, action, createdAt)` for app-layer ones.
   *
   * ## No lock, deliberately
   *
   * Two concurrent writes can both miss and both insert, degrading to one row
   * each - exactly today's behaviour. An audit write must never block the
   * action it is recording, and a duplicated row is a far smaller cost than a
   * contended one.
   */
  protected async coalesceInto(
    data: CreateAudit,
    success: boolean,
  ): Promise<AuditEntity | undefined> {
    const definition = this.auditTypes.get(data.type);
    const windowMs = definition?.coalesceWindowMs;
    if (
      !windowMs ||
      !definition?.coalesce?.actions.includes(data.action) ||
      // Failures stay one row each: two failures are rarely the same failure,
      // and `errorMessage` would have to be merged or dropped.
      !success
    ) {
      return undefined;
    }

    // `nowMillis`, never `Date.now()`, so `travel()` moves the window in
    // tests the way it moves everything else.
    const since = new Date(this.dateTime.nowMillis() - windowMs).toISOString();

    // ⚠️ Built key by key: a `where` carrying an explicit `undefined` throws,
    // and most of these columns are legitimately absent.
    const where: Record<string, unknown> = {
      type: { eq: data.type },
      action: { eq: data.action },
      success: { eq: true },
      createdAt: { gte: since },
    };
    for (const [column, value] of [
      ["scopeType", data.scopeType],
      ["scopeId", data.scopeId],
      ["userId", data.userId],
      ["resourceType", data.resourceType],
      ["resourceId", data.resourceId],
    ] as const) {
      // `isNull` rather than an omitted key: omitting it would match rows
      // that HAVE a value, folding one user's edit into another's.
      where[column] = value === undefined ? { isNull: true } : { eq: value };
    }

    // `findMany` with a limit rather than `findOne`, which takes no ordering:
    // several rows can be open at once when a burst spans a window boundary,
    // and the newest is the one still accepting events.
    const [open] = await this.repo.findMany({
      where: where as never,
      orderBy: { column: "createdAt", direction: "desc" },
      limit: 1,
    });
    if (!open) {
      return undefined;
    }

    const now = new Date(this.dateTime.nowMillis()).toISOString();
    return await this.repo.updateById(open.id, {
      eventCount: (open.eventCount ?? 1) + 1,
      // The row's span. `createdAt` stays where it was, which is what keeps
      // the feed's ordering honest.
      updatedAt: now,
      metadata: this.mergeMetadata(open.metadata, data.metadata),
      // `description` keeps the FIRST value on purpose: it is a write-time
      // snapshot (see `projectActivityRowSchema`), and a burst's identity was
      // fixed when its first event landed.
    } as never);
  }

  /**
   * Merge a later event's metadata into the row's.
   *
   * `fields` is unioned, because the point of a coalesced update row is that
   * it names everything the burst touched. Every other key is last-write-wins,
   * which is the only rule that needs no knowledge of what the key means.
   */
  protected mergeMetadata(
    existing: unknown,
    incoming: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!incoming) {
      return (existing as Record<string, unknown>) ?? undefined;
    }
    const base = (existing as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...base, ...incoming };
    const before = base.fields;
    const after = incoming.fields;
    if (Array.isArray(before) || Array.isArray(after)) {
      merged.fields = [
        ...new Set([
          ...(Array.isArray(before) ? before : []),
          ...(Array.isArray(after) ? after : []),
        ]),
      ];
    }
    return merged;
  }

  /**
   * The `z.text()` cap both clamped columns are declared with.
   */
  protected readonly maxTextLength = 255;

  /**
   * Cut a value to the column's cap, marking that it was cut.
   *
   * The ellipsis is one character of the budget rather than an addition to it,
   * so the result always fits, and it is what tells a reader the value is a
   * prefix rather than the whole thing.
   */
  protected clamp(value: string | undefined): string | undefined {
    if (value == null || value.length <= this.maxTextLength) {
      return value;
    }
    return `${value.slice(0, this.maxTextLength - 1)}…`;
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
  /**
   * A comma-separated filter, as one condition.
   *
   * ⚠️ Never `inArray: []`, which throws: an empty selection is the ABSENCE
   * of a filter, so no clause is added at all. And `eq` rather than a
   * one-element `inArray`, so the common single-value case produces exactly
   * the query it always did.
   */
  protected applyList(
    where: Record<string, unknown>,
    column: "type" | "action",
    value: string | undefined,
  ): void {
    const values = [
      ...new Set(
        (value ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    ];
    if (values.length === 1) {
      where[column] = { eq: values[0] };
    } else if (values.length > 1) {
      where[column] = { inArray: values };
    }
  }

  public async find(query: AuditQuery = {}): Promise<Page<AuditEntity>> {
    this.log.trace("Finding audit entries", { query });

    query.sort ??= "-createdAt";

    const where = this.repo.createQueryWhere();

    // `type` and `action` take a comma-separated list, so a caller can ask
    // for "create or update" in one query. One value still produces an `eq`,
    // so nothing about a single-value caller changed.
    this.applyList(where, "type", query.type);
    this.applyList(where, "action", query.action);

    if (query.severity) {
      where.severity = { eq: query.severity };
    }

    // Both halves, always in front, because every project-layer index leads
    // on the pair. Filtering on `scopeId` alone would fall back to a scan.
    if (query.scopeType) {
      where.scopeType = { eq: query.scopeType };
    }

    // The layer as a whole, for a reader who wants the deployment's own
    // events without the tenants' (or the reverse) and has no one scope in
    // mind. `scopeId` rather than `scopeType` because it is the column the
    // partial indexes are predicated on.
    //
    // Applied before `scopeId`, so naming a scope wins over the layer it
    // belongs to rather than being silently overwritten by it.
    if (query.layer) {
      where.scopeId = { isNull: query.layer === "app" };
    }

    if (query.scopeId) {
      where.scopeId = { eq: query.scopeId };
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

    if (query.after) {
      where.createdAt = { ...(where.createdAt as object), gt: query.after };
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

    // Aggregated in SQL. This used to `findMany({ where })` with no limit and
    // count in JS — O(rows) memory on an admin endpoint, over a table whose
    // whole point is to grow without bound.
    const [byTypeRows, bySeverityRows, bySuccessRows, failures] =
      await Promise.all([
        this.repo.aggregate({
          select: { type: true, id: { count: true } },
          groupBy: ["type"],
          where,
        }),
        this.repo.aggregate({
          select: { severity: true, id: { count: true } },
          groupBy: ["severity"],
          where,
        }),
        this.repo.aggregate({
          select: { success: true, id: { count: true } },
          groupBy: ["success"],
          where,
        }),
        this.repo.findMany({
          where: { ...where, success: { eq: false } },
          orderBy: { column: "createdAt", direction: "desc" },
          limit: 10,
        }),
      ]);

    // `aggregate` nests per-column results: `{ id: { count } }`.
    const countOf = (row: Record<string, any>) => Number(row.id?.count ?? 0);

    const stats: AuditStats = {
      total: 0,
      byType: {},
      bySeverity: { info: 0, warning: 0, critical: 0 },
      successRate: 0,
      recentFailures: failures,
    };

    for (const row of byTypeRows as Array<Record<string, any>>) {
      stats.byType[row.type as string] = countOf(row);
    }

    for (const row of bySeverityRows as Array<Record<string, any>>) {
      const severity = row.severity as AuditSeverity;
      if (severity in stats.bySeverity) {
        stats.bySeverity[severity] = countOf(row);
      }
    }

    let successCount = 0;
    for (const row of bySuccessRows as Array<Record<string, any>>) {
      const n = countOf(row);
      stats.total += n;
      if (row.success) {
        successCount += n;
      }
    }

    stats.successRate = stats.total > 0 ? successCount / stats.total : 1;

    return stats;
  }

  /**
   * Delete audit entries created before the given date (retention policy).
   *
   * @returns number of deleted entries.
   */
  public async deleteOlderThan(date: Date): Promise<number> {
    this.log.info("Deleting old audit entries", { olderThan: date });

    const deleted = await this.repo.deleteMany({
      createdAt: { lt: date.toISOString() },
    });

    this.log.info("Old audit entries deleted", { count: deleted.length });

    return deleted.length;
  }

  /**
   * Delete audit entries that have outlived their retention window.
   *
   * Each registered audit type that declares a dedicated `retentionDays` is
   * pruned using its own window; every other type — including unregistered or
   * legacy types — falls back to `defaultRetentionDays`. A retention of `0`
   * (per-type or default) keeps that scope forever.
   *
   * `now` is injected rather than read from the clock so the policy is
   * deterministic and testable.
   *
   * @param now - reference "now" used to compute cutoff dates.
   * @param defaultRetentionDays - global default for types without an override.
   * @returns total number of deleted entries.
   */
  public async deleteExpired(
    now: Date,
    defaultRetentionDays: number,
  ): Promise<number> {
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff = (days: number): string =>
      new Date(now.getTime() - days * dayMs).toISOString();

    // Audit types carrying their own retention window.
    const overrides = this.getRegisteredTypes().filter(
      (type) => type.retentionDays !== undefined,
    );

    let deleted = 0;

    // 1) Per-type dedicated retention.
    for (const type of overrides) {
      const days = type.retentionDays as number;
      if (days <= 0) {
        continue; // keep this type forever
      }
      const ids = await this.repo.deleteMany({
        type: { eq: type.type },
        createdAt: { lt: cutoff(days) },
      });
      deleted += ids.length;
    }

    // 2) Global default for every other type.
    if (defaultRetentionDays > 0) {
      const overriddenTypes = overrides.map((type) => type.type);
      const ids =
        overriddenTypes.length > 0
          ? await this.repo.deleteMany({
              type: { notInArray: overriddenTypes },
              createdAt: { lt: cutoff(defaultRetentionDays) },
            })
          : await this.repo.deleteMany({
              createdAt: { lt: cutoff(defaultRetentionDays) },
            });
      deleted += ids.length;
    }

    this.log.info("Expired audit entries deleted", {
      count: deleted,
      defaultRetentionDays,
    });

    return deleted;
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
