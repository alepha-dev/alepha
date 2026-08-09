import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * How many bucket columns a row carries: one per boundary in
 * `VITALS_BUCKETS`, plus the overflow bucket `bucketIndex` returns for a value
 * above the last boundary. Every metric shares the same shape — six boundaries
 * — which is what lets one set of columns serve all five.
 */
export const VITALS_BUCKET_COUNT = 7;

export type VitalsBucketColumn = "b0" | "b1" | "b2" | "b3" | "b4" | "b5" | "b6";

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
 *
 * **Seven integer columns, not one JSON blob.** The histogram used to live in a
 * `bucketCounts` JSON column, which meant there was nothing to increment: every
 * sample cost a `findOne` before its `upsert`, and two samples for the same
 * `(hour, metric, path)` arriving together could lose one — a plain
 * read-modify-write race. A column per bucket makes the write
 * `b3 = b3 + excluded.b3` in a single statement: one round-trip, and nothing to
 * lose. The bucket count is fixed, so the width is not a growth risk.
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
    /**
     * One column per bucket index, in the order `bucketIndex` returns. `b6` is
     * the overflow bucket — everything above the last boundary.
     *
     * The defaults are load-bearing twice over: they let a row omit the buckets
     * it has no sample for, and they are what keeps the migration clear of the
     * `ADD COLUMN … NOT NULL` trap on a populated table.
     */
    b0: db.default(z.integer().min(0), 0),
    b1: db.default(z.integer().min(0), 0),
    b2: db.default(z.integer().min(0), 0),
    b3: db.default(z.integer().min(0), 0),
    b4: db.default(z.integer().min(0), 0),
    b5: db.default(z.integer().min(0), 0),
    b6: db.default(z.integer().min(0), 0),
  }),
  indexes: [
    { columns: ["sigilId", "hour", "metric", "path"], unique: true },
    { columns: ["sigilId", "hour"] },
  ],
});

/** Column name for a bucket index, e.g. `3` → `"b3"`. Clamped, so an index from a future boundary list lands in overflow rather than naming a column that does not exist. */
export const vitalsBucketColumn = (index: number): VitalsBucketColumn =>
  `b${Math.min(Math.max(index, 0), VITALS_BUCKET_COUNT - 1)}` as VitalsBucketColumn;

export type SigilVitalHourly = Infer<typeof sigilVitalsHourly.schema>;
export type SigilVitalHourlyInsert = Infer<
  typeof sigilVitalsHourly.insertSchema
>;
