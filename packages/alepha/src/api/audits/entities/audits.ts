import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

/**
 * Audit severity levels for categorizing events.
 */
export const auditSeveritySchema = z
  .enum(["info", "warning", "critical"])
  .describe("Severity level of the audit event")
  .default("info");

export type AuditSeverity = Infer<typeof auditSeveritySchema>;

/**
 * Audit log entity for tracking important system events.
 *
 * Stores comprehensive audit information including:
 * - Who performed the action (userId, userRealm)
 * - What happened (type, action, resource)
 * - When it happened (createdAt)
 * - Context and details (metadata, ipAddress, userAgent)
 */
export const audits = $entity({
  name: "audits",
  schema: z.object({
    id: db.primaryKey(z.bigint()),
    createdAt: db.createdAt(),
    organizationId: db.organization(),

    /**
     * The container the event happened inside, when there is one.
     *
     * An audit log answers "what is happening?" at two layers, and they are
     * not the same question. The **app layer** is who signed in, who created
     * a project: it has no container, so `scopeType` is null and the admin
     * audit page is where it is read. The **project layer** is who filed a
     * quest, who published a release: it belongs to one tenant row, and it is
     * read on that tenant's own activity page by its own members.
     *
     * This is the container, {@link resourceType} is what was acted on:
     * `scopeType: "project"` / `resourceType: "quest"`. The pair is named
     * after `resourceType` / `resourceId` on purpose - an opaque namespaced
     * string like `"project:42"` reinvents a convention this table already
     * has, and has to be parsed apart again to display.
     *
     * ⚠️ Not {@link organizationId}. That column is auto-stamped from the
     * *session's* organization and auto-filters every query, so it is session
     * scope. A scope taken from the request path is a different thing and
     * cannot be expressed through it.
     */
    scopeType: z.text().optional(),

    /**
     * Identifier of the container named by {@link scopeType}, as text so any
     * app's key shape fits (Lore's projects are integers, another app's may
     * be uuids).
     *
     * Null for app-layer events. The four project-layer indexes below are
     * partial on `scope_id IS NOT NULL`, so an app that never sets a scope
     * pays nothing for them.
     */
    scopeId: z.text().optional(),

    /**
     * Audit event type (e.g., "auth", "user", "payment", "system").
     * Used for categorizing and filtering audit events.
     */
    type: z.text({
      description: "Audit event type (e.g., auth, user, payment, system)",
    }),

    /**
     * Specific action performed (e.g., "login", "logout", "create", "update", "delete").
     */
    action: z.text({
      description: "Specific action performed (e.g., login, create, update)",
    }),

    /**
     * Severity level of the event.
     */
    severity: db.default(auditSeveritySchema, "info"),

    /**
     * User ID who performed the action (null for system events).
     */
    userId: z.uuid().optional(),

    /**
     * User realm for multi-tenant support.
     */
    userRealm: z.text().optional(),

    /**
     * User email at the time of the event (denormalized for history).
     */
    userEmail: z.email().optional(),

    /**
     * Resource type affected (e.g., "user", "order", "file").
     */
    resourceType: z.text().optional(),

    /**
     * Resource ID affected.
     */
    resourceId: z.text().optional(),

    /**
     * Human-readable description of the event.
     */
    description: z.text().optional(),

    /**
     * Additional metadata/context as JSON.
     */
    metadata: z.json().optional(),

    /**
     * Client IP address.
     */
    ipAddress: z.text().optional(),

    /**
     * Client user agent.
     */
    userAgent: z.text().optional(),

    /**
     * Session ID if applicable.
     */
    sessionId: z.uuid().optional(),

    /**
     * Request ID for correlation.
     */
    requestId: z.text().optional(),

    /**
     * Whether the action was successful.
     */
    success: db.default(z.boolean(), true),

    /**
     * Error message if the action failed.
     */
    errorMessage: z.text().optional(),

    /**
     * How many identical events this row stands for.
     *
     * `1` for every row unless its type opted the action into coalescing (see
     * `$audit`'s `coalesce`), in which case a burst of identical events inside
     * the window bumps this instead of inserting again. An MCP session editing
     * one folio ten times in twenty minutes is ten genuine events and ten
     * near-identical rows, and a reader learns nothing from the ninth.
     *
     * Defaulted rather than optional so every reader can add it up without a
     * null check, and so an app that never opts in is unaffected beyond the
     * column itself.
     */
    eventCount: db.default(z.integer(), 1),

    /**
     * When the LAST event folded into this row landed.
     *
     * Optional on purpose, and its absence is meaningful: a row that was never
     * coalesced has one event, and `createdAt` already says when. Present, it
     * gives the burst its span - `createdAt` to here - which is what the
     * activity feed's tooltip reads.
     *
     * ⚠️ NOT `db.updatedAt()`. That stamps on every write including the
     * insert, which would make every row in the table claim a span it does
     * not have.
     */
    updatedAt: z.datetime().optional(),
  }),
  /**
   * Every index here is composite and ends on `createdAt`, because every
   * query this table serves is `WHERE <filters> ORDER BY created_at DESC`.
   *
   * SQLite uses one index per table per query, so a set of single-column
   * indexes cannot be combined to answer that shape: it would seek on one
   * column and then sort the result. This table carried eight of them, which
   * cost eight index writes per insert and served the sort in none of the
   * cases. A `WHERE`-prefix followed by the sort column lets the planner seek
   * and then walk the index backwards, so a `LIMIT 50` reads fifty rows.
   *
   * `severity` has no index at all: three distinct values over a growing
   * table is a scan either way.
   */
  indexes: [
    // --- Project layer -----------------------------------------------------
    // Partial, so an app that never sets a scope pays nothing for these four.
    // A scoped read always knows both halves of the scope, so every one of
    // them leads on the pair.
    {
      columns: ["scopeType", "scopeId", "createdAt"],
      where: sql`scope_id IS NOT NULL`,
    },
    {
      columns: ["scopeType", "scopeId", "userId", "createdAt"],
      where: sql`scope_id IS NOT NULL`,
    },
    // Serves a filter on `type` alone as well as `type` + `action`, since
    // `type` is the leading column of the pair.
    {
      columns: ["scopeType", "scopeId", "type", "action", "createdAt"],
      where: sql`scope_id IS NOT NULL`,
    },
    // `action` across every type ("show me all the deletes"), which the index
    // above cannot serve because `type` sits in front of it.
    {
      columns: ["scopeType", "scopeId", "action", "createdAt"],
      where: sql`scope_id IS NOT NULL`,
    },

    // --- App layer ---------------------------------------------------------
    "createdAt",
    { columns: ["type", "action", "createdAt"] },
    { columns: ["userId", "createdAt"] },
    { columns: ["userRealm", "createdAt"] },
    // Backs `AuditService.findByResource`, and a filter on `resourceType`
    // alone by prefix.
    { columns: ["resourceType", "resourceId", "createdAt"] },
  ],
});

export const auditEntitySchema = audits.schema;
export const auditEntityInsertSchema = audits.insertSchema;
export type AuditEntity = Infer<typeof audits.schema>;
