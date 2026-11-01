import { type Infer, z } from "alepha";

/**
 * The Reports Delivery tab (#Q3008): DORA's four keys, then what ran.
 */
export const reportsDeliverySchema = z.object({
  /**
   * Deploys per week over the period, succeeded ones.
   */
  deploysPerWeek: z.number(),
  /**
   * From a quest's completion to the first successful deploy carrying it.
   * `unmatched` quests name no release tag or commit a deploy ran.
   */
  lead: z.object({
    measured: z.integer(),
    unmatched: z.integer(),
    medianHours: z.number(),
    p85Hours: z.number(),
  }),
  /**
   * Failed deploys and rollbacks, over all finished deploys, as a percentage.
   */
  changeFailureRate: z.number(),
  failed: z.integer(),
  rollbacks: z.integer(),
  /**
   * Incident start to incident end, over the incidents closed in the period.
   */
  restore: z.object({
    incidents: z.integer(),
    medianMinutes: z.number(),
    p85Minutes: z.number(),
  }),
  /**
   * Per app and environment, busiest first.
   */
  apps: z.array(
    z.object({
      app: z.string(),
      env: z.string(),
      succeeded: z.integer(),
      failed: z.integer(),
      rollbacks: z.integer(),
      medianDurationMinutes: z.number(),
    }),
  ),
  /**
   * Per grain: deploys, how many succeeded, and how long they took.
   */
  timeline: z.array(
    z.object({
      date: z.string(),
      succeeded: z.integer(),
      failed: z.integer(),
      successRate: z.number(),
      medianDurationMinutes: z.number(),
    }),
  ),
});

export type ReportsDelivery = Infer<typeof reportsDeliverySchema>;
