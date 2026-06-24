import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * Web-Vitals histogram buckets for sigil analytics.
 *
 * One row per `(sigilId, date, path, metric, bucket)` — a count of how many
 * CLS/FCP/INP/LCP/TTFB samples fell into that bucket on that UTC day for that
 * page. Every vitals event `INSERT … ON CONFLICT DO UPDATE SET count = count + 1`
 * increments the matching bucket row, so storage is bounded by
 * *distinct (path × metric × bucket) cardinality*, not traffic volume.
 *
 * The `metric` field is one of the five Core Web Vitals identifiers:
 * - `lcp`  — Largest Contentful Paint (ms)
 * - `cls`  — Cumulative Layout Shift (unitless × 1000)
 * - `inp`  — Interaction to Next Paint (ms)
 * - `fcp`  — First Contentful Paint (ms)
 * - `ttfb` — Time to First Byte (ms)
 *
 * `bucket` is a non-negative integer index into a fixed set of per-metric
 * histogram boundaries defined on the embed side. The p75 approximation is
 * derived from these histogram totals server-side.
 *
 * NB on the primary key: Alepha's SQLite model builder only honors a
 * single-column `PRIMARY KEY`, so this table carries a surrogate autoincrement
 * `id` PK and enforces the five-tuple via a UNIQUE index instead — the
 * upsert's `ON CONFLICT` targets that index.
 *
 * Purely additive `CREATE TABLE` — D1-safe. The `cascade` on `sigilId` only
 * fires when the parent sigil is deleted (and sigils cascade from campaign
 * delete) — same chain as the other sigil-scoped tables.
 */
export const sigilVitals = $entity({
  name: "sigil_vitals",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
      onDelete: "cascade",
    }),
    /** UTC day bucket, `YYYY-MM-DD`. */
    date: z.string().min(10).max(10),
    /** Page path, query + fragment stripped. */
    path: z.string().min(1).max(1_024),
    /** Core Web Vitals metric identifier. */
    metric: z.enum(["lcp", "cls", "inp", "fcp", "ttfb"]).meta({ mode: "text" }),
    /** Non-negative histogram bucket index. */
    bucket: z.integer().min(0),
    /** Sample count for this `(sigilId, date, path, metric, bucket)` tuple. */
    count: db.default(z.integer().min(1), 1),
  }),
  indexes: [
    {
      columns: ["sigilId", "date", "path", "metric", "bucket"],
      unique: true,
    },
    { columns: ["sigilId", "date", "metric"] },
  ],
});

export type SigilVitals = Static<typeof sigilVitals.schema>;
export type SigilVitalsInsert = Static<typeof sigilVitals.insertSchema>;
