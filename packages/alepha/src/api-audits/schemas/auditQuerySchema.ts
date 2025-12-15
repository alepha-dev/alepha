import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";
import { auditSeveritySchema } from "../entities/audits.ts";

/**
 * Query schema for searching and filtering audit logs.
 */
export const auditQuerySchema = t.extend(pageQuerySchema, {
  type: t.optional(t.text({ description: "Filter by audit type" })),
  action: t.optional(t.text({ description: "Filter by action" })),
  severity: t.optional(auditSeveritySchema),
  userId: t.optional(t.uuid({ description: "Filter by user ID" })),
  userRealm: t.optional(t.text({ description: "Filter by user realm" })),
  resourceType: t.optional(t.text({ description: "Filter by resource type" })),
  resourceId: t.optional(t.text({ description: "Filter by resource ID" })),
  success: t.optional(t.boolean({ description: "Filter by success status" })),
  from: t.optional(t.datetime({ description: "Start date filter" })),
  to: t.optional(t.datetime({ description: "End date filter" })),
  search: t.optional(t.text({ description: "Search in description" })),
});

export type AuditQuery = Static<typeof auditQuerySchema>;
