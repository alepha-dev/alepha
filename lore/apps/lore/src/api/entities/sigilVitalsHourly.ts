import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * Web-vitals samples, kept as bucket counts rather than values.
 *
 * A histogram answers the only question worth asking of a performance metric —
 * "what fraction of visits were bad?" — and it answers it at constant storage
 * cost. Keeping raw values would grow with traffic to compute the same
 * percentiles.
 *
 * The bucket boundaries come from `@alepha/sigil/vitals`, shared so the chart
 * and the ingest agree on what "good" means.
 */
export const sigilVitalsHourly = $entity({
  name: "sigil_vitals_hourly",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    /** UTC hour bucket, `YYYY-MM-DDTHH`. */
    hour: z.string().min(13).max(13),
    metric: z.enum(["lcp", "cls", "inp", "fcp", "ttfb"]).meta({ mode: "text" }),
    path: z.string().min(1).max(1024),
    /** Bucket index → count, using the shared boundaries. */
    bucketCounts: db.default(z.record(z.string(), z.number()), {}),
  }),
  indexes: [
    { columns: ["sigilId", "hour", "metric", "path"], unique: true },
    { columns: ["sigilId", "hour"] },
  ],
});

export type SigilVitalHourly = Static<typeof sigilVitalsHourly.schema>;
export type SigilVitalHourlyInsert = Static<
  typeof sigilVitalsHourly.insertSchema
>;
