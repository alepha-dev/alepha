import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

import { auditSeveritySchema } from "../entities/audits.ts";

/**
 * Query schema for searching and filtering audit logs.
 */
export const auditQuerySchema = pageQuerySchema.extend({
  type: z.text({ description: "Filter by audit type" }).optional(),
  action: z.text({ description: "Filter by action" }).optional(),
  severity: auditSeveritySchema.optional(),
  userId: z.uuid().describe("Filter by user ID").optional(),
  userRealm: z.text({ description: "Filter by user realm" }).optional(),
  resourceType: z.text({ description: "Filter by resource type" }).optional(),
  resourceId: z.text({ description: "Filter by resource ID" }).optional(),
  success: z.boolean().describe("Filter by success status").optional(),
  from: z.datetime().describe("Start date filter").optional(),
  to: z.datetime().describe("End date filter").optional(),
  search: z.text({ description: "Search in description" }).optional(),
});

export type AuditQuery = Infer<typeof auditQuerySchema>;
