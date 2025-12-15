import type { Static } from "alepha";
import { t } from "alepha";
import { auditSeveritySchema } from "../entities/audits.ts";

/**
 * Schema for creating a new audit log entry.
 */
export const createAuditSchema = t.object({
  type: t.text({ description: "Audit event type" }),
  action: t.text({ description: "Specific action performed" }),
  severity: t.optional(auditSeveritySchema),
  userId: t.optional(t.uuid()),
  userRealm: t.optional(t.text()),
  userEmail: t.optional(t.email()),
  resourceType: t.optional(t.text()),
  resourceId: t.optional(t.text()),
  description: t.optional(t.text()),
  metadata: t.optional(t.json()),
  ipAddress: t.optional(t.text()),
  userAgent: t.optional(t.text()),
  sessionId: t.optional(t.uuid()),
  requestId: t.optional(t.text()),
  success: t.optional(t.boolean()),
  errorMessage: t.optional(t.text()),
});

export type CreateAudit = Static<typeof createAuditSchema>;
