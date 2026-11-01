import { type Infer, z } from "alepha";

import { capabilityKeySchema } from "./capabilityKeySchema.ts";

/**
 * One line of the Reports Summary tab (#Q2999): a module's figure for the
 * period, beside the period before it.
 */
export const reportsSummaryLineSchema = z.object({
  /**
   * Stable, and the label's key: `reports.summary.line.<key>`.
   */
  key: z.text(),
  capability: capabilityKeySchema,
  value: z.number(),
  /**
   * The previous period's figure. Absent for a figure with no past to read
   * (open blights today), and when the period has no start.
   */
  previous: z.number().optional(),
  format: z.enum(["count", "hours", "percent"]),
  /**
   * Which way is good news. Absent for a neutral figure.
   */
  upIsGood: z.boolean().optional(),
  /**
   * The Reports tab this line links to, when the project has it.
   */
  tab: z.text().optional(),
});

export const reportsSummarySchema = z.object({
  lines: z.array(reportsSummaryLineSchema),
});

export type ReportsSummaryLine = Infer<typeof reportsSummaryLineSchema>;
