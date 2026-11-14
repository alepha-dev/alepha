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
  /**
   * Errors, error occurrences and uptime (#Q3009).
   */
  reliability: z.object({
    /**
     * Per grain: new errors, resolved ones, and how many stood open at its
     * end. A resolved error sits on the day it was last seen: nothing records
     * when it was resolved.
     */
    projectErrors: z.array(
      z.object({
        date: z.string(),
        opened: z.integer(),
        resolved: z.integer(),
        open: z.integer(),
      }),
    ),
    topErrors: z.array(
      z.object({
        name: z.string(),
        origin: z.string(),
        count: z.integer(),
        status: z.string(),
      }),
    ),
    /**
     * Errors forwarded to a quest, and from first seen to that quest done.
     */
    forwarded: z.object({
      total: z.integer(),
      fixed: z.integer(),
      medianFixHours: z.number(),
      p85FixHours: z.number(),
    }),
    errors: z.array(z.object({ date: z.string(), count: z.number() })),
    /**
     * The grains holding a successful deploy.
     */
    deployMarkers: z.array(z.string()),
    monitors: z.array(
      z.object({
        name: z.string(),
        /**
         * Absent with no probe in the period.
         */
        uptime: z.number().optional(),
        incidents: z.integer(),
        mttrMinutes: z.number(),
      }),
    ),
  }),
});

export type ReportsDelivery = Infer<typeof reportsDeliverySchema>;
