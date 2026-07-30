import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { pulseApps } from "./pulseApps.ts";

/**
 * Web-vitals samples, kept as bucket counts rather than values.
 *
 * A histogram answers the only question worth asking of a performance metric —
 * "what fraction of visits were bad?" — and it answers it at constant storage
 * cost. Keeping raw values would grow with traffic to compute the same
 * percentiles.
 *
 * The bucket boundaries come from `@alepha/telemetry/vitals`, shared so the
 * chart and the ingest agree on what "good" means.
 */
export const vitalsHourly = $entity({
  name: "vitals_hourly",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    appId: db.ref(z.uuid(), () => pulseApps.cols.id, { onDelete: "cascade" }),
    /** UTC hour bucket, `YYYY-MM-DDTHH`. */
    hour: z.string().min(13).max(13),
    metric: z.enum(["lcp", "cls", "inp", "fcp", "ttfb"]).meta({ mode: "text" }),
    path: z.string().min(1).max(1024),
    /** Bucket index → count, using the shared boundaries. */
    bucketCounts: db.default(z.record(z.string(), z.number()), {}),
  }),
  indexes: [
    { columns: ["appId", "hour", "metric", "path"], unique: true },
    { columns: ["appId", "hour"] },
  ],
});

export type VitalHourly = Static<typeof vitalsHourly.schema>;
export type VitalHourlyInsert = Static<typeof vitalsHourly.insertSchema>;
