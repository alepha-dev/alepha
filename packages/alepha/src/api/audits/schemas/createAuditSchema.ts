import type { Infer } from "alepha";
import { z } from "alepha";

import { auditSeveritySchema } from "../entities/audits.ts";

/**
 * Schema for creating a new audit log entry.
 */
export const createAuditSchema = z.object({
  type: z.text({ description: "Audit event type" }),
  action: z.text({ description: "Specific action performed" }),
  severity: auditSeveritySchema.optional(),
  userId: z.uuid().optional(),
  userRealm: z.text().optional(),
  userEmail: z.email().optional(),
  resourceType: z.text().optional(),
  resourceId: z.text().optional(),
  description: z.text().optional(),
  metadata: z.json().optional(),
  ipAddress: z.text().optional(),
  userAgent: z.text().optional(),
  sessionId: z.uuid().optional(),
  requestId: z.text().optional(),
  success: z.boolean().optional(),
  errorMessage: z.text().optional(),
});

export type CreateAudit = Infer<typeof createAuditSchema>;
