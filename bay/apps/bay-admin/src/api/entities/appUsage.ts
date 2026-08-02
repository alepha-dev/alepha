import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * What each app cost, sampled once a minute.
 *
 * The numbers come from Bay's supervisor — the cgroup charge systemd enforces
 * `MemoryMax` against — not from anything running inside the app. That matters
 * twice over:
 *
 *   - It works for **every** app Bay hosts, including ones that embed nothing
 *     and ones that are not Alepha at all. An app cannot forget to report.
 *   - It is the number that predicts an OOM kill. A process reading its own
 *     `rss` sees a smaller figure than the cgroup does, because the cgroup also
 *     counts the page cache that process has touched — and that is what the
 *     limit is applied to.
 *
 * Nothing here is telemetry. Telemetry is an app describing itself to a
 * collector it chose; this is a supervisor describing a process it owns.
 *
 * One row per app per minute is ~1 500 rows a day for three apps. Bounded by
 * the retention job rather than by rollup: averaging memory into an hourly
 * bucket would erase the spike that preceded the kill, and that spike is the
 * entire reason to keep the series.
 */
export const appUsage = $entity({
  name: "app_usage",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    /** `name/env`, the same key Bay uses. */
    appKey: z.string(),
    /** When bay-admin took the sample. */
    at: z.string(),
    /**
     * Whether the supervisor considered the app running at that moment.
     *
     * Recorded alongside the numbers rather than inferred from their absence:
     * "the app was stopped" and "bay-admin could not reach Bay" both produce a
     * gap, and only one of them is the app's fault.
     */
    running: z.boolean(),
    memoryBytes: z.integer().optional(),
    /**
     * Cumulative CPU seconds since the unit last started — NOT a rate.
     *
     * Stored raw because the reader can difference two samples but cannot undo
     * an average. It resets to zero on restart, so a consumer computing a rate
     * has to drop any interval where the value went down; `restarts` is how it
     * tells that apart from a clock problem.
     */
    cpuSeconds: z.number().optional(),
    tasks: z.integer().optional(),
    restarts: z.integer().optional(),
  }),
  indexes: [{ columns: ["appKey", "at"] }],
});

export type AppUsage = Infer<typeof appUsage.schema>;
export type AppUsageInsert = Infer<typeof appUsage.insertSchema>;
