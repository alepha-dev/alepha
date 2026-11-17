import { type Infer, z } from "alepha";

/**
 * How a non-functional requirement is verified by a measure (#E153): a web
 * vital of a sigil at a percentile, or the availability or latency of a
 * monitor, on an app copy (production by default), against a threshold,
 * over a window (7 days by default). Read from what Ship already stores.
 *
 * Availability is met at or above its threshold (a percentage); a vital
 * and a latency are met at or below theirs (milliseconds, or a unitless
 * score for CLS).
 */
export const requirementMetricSchema = z.object({
  kind: z.enum(["vital", "availability", "latency"]),
  vital: z.enum(["lcp", "inp", "cls"]).optional(),
  /**
   * 75 by default for a vital, 95 for a latency.
   */
  percentile: z.integer().min(1).max(99).optional(),
  /**
   * A path pattern of the sigil, `*` matching anything (`/checkout/*`).
   */
  path: z.string().max(200).optional(),
  /**
   * The monitor, for availability and latency; else the first monitor of
   * the app copy.
   */
  monitorId: z.uuid().optional(),
  app: z.string().max(100).optional(),
  env: z.string().max(100).optional(),
  threshold: z.number(),
  windowDays: z.integer().min(1).max(90).optional(),
});

export type RequirementMetric = Infer<typeof requirementMetricSchema>;

export const metricStatusSchema = z.enum(["verified", "failing", "no_data"]);

export type MetricStatus = Infer<typeof metricStatusSchema>;
