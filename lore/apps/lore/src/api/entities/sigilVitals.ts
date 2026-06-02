import { type Static, t } from "alepha";
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
  schema: t.object({
    id: db.primaryKey(t.integer()),
    sigilId: db.ref(t.uuid(), () => sigils.cols.id, {
      onDelete: "cascade",
    }),
    /** UTC day bucket, `YYYY-MM-DD`. */
    date: t.string({ minLength: 10, maxLength: 10 }),
    /** Page path, query + fragment stripped. */
    path: t.string({ minLength: 1, maxLength: 1_024 }),
    /** Core Web Vitals metric identifier. */
    metric: t.enum(["lcp", "cls", "inp", "fcp", "ttfb"], { mode: "text" }),
    /** Non-negative histogram bucket index. */
    bucket: t.integer({ minimum: 0 }),
    /** Sample count for this `(sigilId, date, path, metric, bucket)` tuple. */
    count: db.default(t.integer({ minimum: 1 }), 1),
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
