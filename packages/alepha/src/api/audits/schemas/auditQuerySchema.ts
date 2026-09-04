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
  scopeType: z.text({ description: "Filter by scope type" }).optional(),
  scopeId: z.text({ description: "Filter by scope id" }).optional(),
  /**
   * Narrow to one layer without naming a scope: `app` keeps the rows that
   * belong to the deployment rather than to any tenant, `scoped` keeps the
   * rest. Distinct from `scopeType`, which selects ONE kind of container.
   */
  layer: z.enum(["app", "scoped"]).describe("Filter by audit layer").optional(),
  userId: z.uuid().describe("Filter by user ID").optional(),
  userRealm: z.text({ description: "Filter by user realm" }).optional(),
  resourceType: z.text({ description: "Filter by resource type" }).optional(),
  resourceId: z.text({ description: "Filter by resource ID" }).optional(),
  success: z.boolean().describe("Filter by success status").optional(),
  from: z.datetime().describe("Start date filter (inclusive)").optional(),
  /**
   * Exclusive lower bound, for a caller paging forward through the log with a
   * timestamp cursor.
   *
   * Distinct from `from` rather than replacing it, because the two answer
   * different questions: `from` is "the window starts here", `after` is "I
   * have already seen everything up to and including here". Handing a cursor
   * to an inclusive bound re-reports the boundary event on every call, which
   * for an agent reads as the same comment arriving forever.
   *
   * ⚠️ This excludes the boundary only as precisely as the column stores it.
   * On sqlite (and so on D1, where `created_at` is an integer millisecond)
   * that is exact. On postgres the column keeps microseconds while a caller's
   * cursor is a millisecond ISO stamp, so a row written at `.123456` is NOT
   * excluded by an `after` of `.123`. A caller that must not see the boundary
   * row twice compares the value it was given as well, the way
   * `project_activity` does - the exposed stamp is the one it reasoned about.
   */
  after: z
    .datetime()
    .describe("Start date filter (exclusive), for a forward cursor")
    .optional(),
  to: z.datetime().describe("End date filter").optional(),
  search: z.text({ description: "Search in description" }).optional(),
});

export type AuditQuery = Infer<typeof auditQuerySchema>;
