import { type Infer, z } from "alepha";

/**
 * How a non-functional requirement is verified by a measure (#E153): a web
 * vital of a sigil at a percentile, the availability or latency of a
 * monitor, or the API latency of a route the app's server answers (#Q3777),
 * on an app copy (production by default), against a threshold, over a
 * window (7 days by default). Read from what Ship already stores.
 *
 * Availability is met at or above its threshold (a percentage); a vital,
 * a latency and an API latency are met at or below theirs (milliseconds,
 * or a unitless score for CLS).
 */
export const requirementMetricSchema = z.object({
  kind: z.enum(["vital", "availability", "latency", "api"]),
  vital: z.enum(["lcp", "inp", "cls"]).optional(),
  /**
   * 75 by default for a vital, 95 for a latency or an API latency.
   */
  percentile: z.integer().min(1).max(99).optional(),
  /**
   * A path pattern of the sigil, `*` matching anything (`/checkout/*`). For
   * an API latency, a pattern of the server's route patterns
   * (`/api/orders/*`, `/api/orders/:id`).
   */
  path: z.string().max(200).optional(),
  /**
   * The HTTP method, for an API latency: every method when absent.
   */
  method: z.string().max(16).optional(),
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
