import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

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
export type AuditEntity = Infer<typeof audits.schema>;
