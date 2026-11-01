import { type Infer, z } from "alepha";

/**
 * The Reports Support tab (#Q3006): feedback from intake to shipped.
 */
export const reportsSupportSchema = z.object({
  /**
   * Reports received per grain, by their `type=` tag.
   */
  intake: z.array(
    z.object({
      date: z.string(),
      bug: z.integer(),
      feature: z.integer(),
      other: z.integer(),
    }),
  ),
  /**
   * Reports received in the period per `severity=` tag. One with none is
   * counted under an empty value.
   */
  severity: z.array(z.object({ value: z.string(), count: z.integer() })),
  /**
   * Where the reports received in the period stand now.
   */
  outcomes: z.object({
    accepted: z.integer(),
    rejected: z.integer(),
    pending: z.integer(),
  }),
  triage: z.object({
    measured: z.integer(),
    /**
     * Triaged reports with no timestamp: their audit was gone at the backfill.
     */
    unknown: z.integer(),
    medianHours: z.number(),
    p85Hours: z.number(),
  }),
  conversion: z.object({
    accepted: z.integer(),
    withQuest: z.integer(),
    shipped: z.integer(),
    medianResolutionHours: z.number(),
    p85ResolutionHours: z.number(),
  }),
  /**
   * Reports waiting for triage now, by age. Keys are named by the locale:
   * `reports.backlog.age.<key>`.
   */
  pendingAge: z.array(z.object({ key: z.text(), count: z.integer() })),
  /**
   * The busiest `host=` and `path=` tags of the period.
   */
  sources: z.array(z.object({ value: z.string(), count: z.integer() })),
});

export type ReportsSupport = Infer<typeof reportsSupportSchema>;
