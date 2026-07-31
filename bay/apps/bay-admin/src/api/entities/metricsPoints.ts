import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { pulseApps } from "./pulseApps.ts";

/**
 * Raw metric samples, one row per series per interval.
 *
 * Deliberately not rolled up on write, unlike views: a metric's shape matters.
 * Averaging memory into an hourly bucket at ingest would erase the spike that
 * preceded an OOM, and that spike is the whole reason to keep the series.
 *
 * Bounded by retention instead — raw kept briefly, then downsampled, then
 * dropped. Which makes the retention job load-bearing, not housekeeping: with
 * one app reporting every 30 s this table gains ~14 000 rows a day.
 */
export const metricsPoints = $entity({
  name: "metrics_points",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    appId: db.ref(z.uuid(), () => pulseApps.cols.id, { onDelete: "cascade" }),
    series: z
      .enum([
        "rss",
        "heapUsed",
        "eventLoopDelayP95",
        "reqCount",
        "reqDurationP95",
      ])
      .meta({ mode: "text" }),
    /** When the sample was taken, as reported by the app — not on arrival. */
    at: z.string(),
    value: z.number(),
  }),
  indexes: [{ columns: ["appId", "series", "at"] }],
});

export type MetricsPoint = Static<typeof metricsPoints.schema>;
export type MetricsPointInsert = Static<typeof metricsPoints.insertSchema>;
