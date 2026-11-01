import { type Infer, z } from "alepha";

import { prioritySchema } from "../../mcp/schemas/prioritySchema.ts";

/**
 * The query of every report (#Q2995): a period, a grain, a comparison, the
 * Work filters and the thresholds that used to be constants. Shared by the
 * report actions, the Reports filter bar and the dashboard's fixed query.
 *
 * Every key is optional. An absent `from` means "no lower bound", so the empty
 * query is the project's whole history, which is what a dashboard tile reads.
 */
export const reportsQuerySchema = z.object({
  /**
   * The period's bounds, inclusive. `compare` needs both a `from` and a known
   * end (`to`, or now).
   */
  from: z.datetime().optional(),
  to: z.datetime().optional(),
  /**
   * The width of a point on a time axis. Absent, the axis picks one from the
   * period's length.
   */
  grain: z.enum(["day", "week", "month"]).optional(),
  /**
   * Return the figures of the period of the same length right before this one.
   */
  compare: z.boolean().optional(),
  area: z.text().optional(),
  epicId: z.integer().optional(),
  releaseId: z.integer().optional(),
  tag: z.text().optional(),
  priority: prioritySchema.optional(),
  /**
   * The member a quest is assigned to or was completed by.
   */
  memberId: z.uuid().optional(),
  /**
   * Days in progress after which a quest reads as stale. Default 14.
   */
  staleDays: z.integer().min(1).optional(),
  /**
   * How many values a breakdown keeps. Default 8.
   */
  top: z.integer().min(1).optional(),
  /**
   * How many of the oldest open quests the aging list keeps. Default 10.
   */
  agingLimit: z.integer().min(1).optional(),
});

export type ReportsQuery = Infer<typeof reportsQuerySchema>;
