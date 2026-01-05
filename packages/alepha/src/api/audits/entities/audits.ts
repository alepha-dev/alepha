import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Audit severity levels for categorizing events.
 */
export const auditSeveritySchema = t.enum(["info", "warning", "critical"], {
  default: "info",
  description: "Severity level of the audit event",
});

export type AuditSeverity = Static<typeof auditSeveritySchema>;

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
  schema: t.object({
    id: db.primaryKey(t.bigint()),
    createdAt: db.createdAt(),

    /**
     * Audit event type (e.g., "auth", "user", "payment", "system").
     * Used for categorizing and filtering audit events.
     */
    type: t.text({
      description: "Audit event type (e.g., auth, user, payment, system)",
    }),

    /**
     * Specific action performed (e.g., "login", "logout", "create", "update", "delete").
     */
    action: t.text({
      description: "Specific action performed (e.g., login, create, update)",
    }),

    /**
     * Severity level of the event.
     */
    severity: db.default(auditSeveritySchema, "info"),

    /**
     * User ID who performed the action (null for system events).
     */
    userId: t.optional(t.uuid()),

    /**
     * User realm for multi-tenant support.
     */
    userRealm: t.optional(t.text()),

    /**
     * User email at the time of the event (denormalized for history).
     */
    userEmail: t.optional(t.email()),

    /**
     * Resource type affected (e.g., "user", "order", "file").
     */
    resourceType: t.optional(t.text()),

    /**
     * Resource ID affected.
     */
    resourceId: t.optional(t.text()),

    /**
     * Human-readable description of the event.
     */
    description: t.optional(t.text()),

    /**
     * Additional metadata/context as JSON.
     */
    metadata: t.optional(t.json()),

    /**
     * Client IP address.
     */
    ipAddress: t.optional(t.text()),

    /**
     * Client user agent.
     */
    userAgent: t.optional(t.text()),

    /**
     * Session ID if applicable.
     */
    sessionId: t.optional(t.uuid()),

    /**
     * Request ID for correlation.
     */
    requestId: t.optional(t.text()),

    /**
     * Whether the action was successful.
     */
    success: db.default(t.boolean(), true),

    /**
     * Error message if the action failed.
     */
    errorMessage: t.optional(t.text()),
  }),
  indexes: [
    "createdAt",
    "type",
    "action",
    "userId",
    "userRealm",
    "resourceType",
    "resourceId",
    "severity",
    { columns: ["type", "action"] },
    { columns: ["userId", "createdAt"] },
    { columns: ["userRealm", "createdAt"] },
  ],
});

export const auditEntitySchema = audits.schema;
export const auditEntityInsertSchema = audits.insertSchema;
export type AuditEntity = Static<typeof audits.schema>;
