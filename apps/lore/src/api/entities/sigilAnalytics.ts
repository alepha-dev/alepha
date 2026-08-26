import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { sigils } from "./sigils.ts";

/**
 * How many bucket columns a vitals row carries: one per boundary in
 * `VITALS_BUCKETS`, plus the overflow bucket `bucketIndex` returns for a value
 * above the last boundary. Every metric shares the same shape — six boundaries
 * — which is what lets one set of columns serve all five.
 */
export const VITALS_BUCKET_COUNT = 7;

export type VitalsBucketColumn = "b0" | "b1" | "b2" | "b3" | "b4" | "b5" | "b6";

/**
 * Column name for a bucket index, e.g. `3` → `"b3"`. Clamped, so an index from
 * a future boundary list lands in overflow rather than naming a column that
 * does not exist.
 */
export const vitalsBucketColumn = (index: number): VitalsBucketColumn =>
  `b${Math.min(Math.max(index, 0), VITALS_BUCKET_COUNT - 1)}` as VitalsBucketColumn;

/**
 * Stands in for a visitor hash on a collapsed uniques row. A single character,
 * where every real `visitorHash` is a 64-char hex digest — they cannot
 * collide, and the unique index on `(sigilId, day, visitorHash)` gives the
 * collapsed row its uniqueness per `(sigilId, day)` for free.
 */
export const UNIQUES_COLLAPSED_HASH = "*";

/**
 * The three sigil aggregate tables: views, uniques, vitals.
 *
 * They lived in `@alepha/sigil/ingest` for a while, behind a factory that took
 * `sigils.cols.id` as a parameter. That indirection existed for exactly one
 * reason: every table carries
 * `db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" })`, and
 * `sigils` is *this app's* entity, referencing this app's `projects`. A
 * package cannot own that column without owning the whole chain.
 *
 * The factory is gone because the premise is. What the package shipped was not
 * "the receiving half of a sigil" - the envelope handling, path normalisation,
 * country and visitor plumbing, error groups and blights were always here in
 * `apps/lore` - it was one app's storage schema, and this app had already
 * reversed two thirds of it (see `sigilViewsHourly.ts` and
 * `sigilVitalsHourly.ts`: both frozen). What a second sink genuinely needs to
 * speak the protocol - the ingest path, the envelope schema, the key format -
 * is still shared, from `@alepha/sigil`. Storage is not protocol.
 *
 * The cascade is load-bearing and is why dropping the ref for a plain uuid was
 * rejected: deleting a sigil erases everything it ever reported, which is
 * exactly why the UI tells the operator to **rotate** rather than delete.
 *
 * Table names, columns, defaults and indexes are unchanged by the move back, so
 * it generates no migration - and that is checked, not assumed:
 * `yarn check:migrations` diffs the entities against the snapshot.
 *
 * The three `sigil*.ts` siblings re-export one entity each, so every existing
 * import site is untouched and the file-per-entity convention survives.
 */
const sigilId = () =>
  db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" });

/**
 * Page views, rolled up on write.
 *
 * One row per `(sigilId, hour, path, country)`, incremented on ingest.
 * Storage is bounded by how many distinct pages an app has, not by how much
 * traffic it gets — the difference between a table that grows with the site
 * and one that grows with its success.
 *
 * Hourly rather than daily: a deploy at 14:00 that breaks a page should be
 * visible against 13:00, and a day bucket hides exactly that.
 *
 * ⚠️ The count is best-effort. Nothing throttles an app's own reporting, so
 * the number is inflatable by whoever holds the sigil token. The trustworthy
 * metric is the unique-visitor count.
 */
const views = $entity({
  name: "sigil_views_hourly",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: sigilId(),
    /**
     * UTC hour bucket, `YYYY-MM-DDTHH`.
     */
    hour: z.string().min(13).max(13),
    /**
     * Page path, query and fragment stripped.
     */
    path: z.string().min(1).max(1024),
    /**
     * Coarse ISO-3166 country from the edge; `ZZ` when unknown.
     */
    country: db.default(z.string().min(1).max(8), "ZZ"),
    count: db.default(z.integer().min(1), 1),
  }),
  indexes: [
    { columns: ["sigilId", "hour", "path", "country"], unique: true },
    { columns: ["sigilId", "hour"] },
  ],
});

/**
 * One row per visitor per sigil per day — the cookieless unique count.
 *
 * `visitorHash` is computed by the app's own server, the only party that
 * ever sees the IP: `sha256(host + ip + userAgent + dailySalt)`. The raw
 * address never leaves that machine, and the salt rotates every UTC day,
 * which is what makes the value useless as a durable identifier while still
 * counting someone once per day. The salt must be derived from a secret —
 * a public salt turns this column into a lookup table answering "was this IP
 * with this user-agent here today?" for one SHA-256 per guess.
 *
 * No cookie on purpose. An analytics cookie is not "strictly necessary"
 * under ePrivacy, so it would require consent — a banner in every app that
 * reports here. The cost is accuracy: a corporate NAT merges visitors, and
 * someone switching networks counts twice.
 *
 * Rows, not a counter, because "unique" cannot be incremented — you have to
 * know whether you have seen this one today.
 *
 * **Two row shapes live here.** A *hash row* is the above: one visitor, one
 * day, `count = 1`. A *collapsed row* uses {@link UNIQUES_COLLAPSED_HASH} in
 * place of a hash and carries the day's total in `count`. Collapsing stops
 * growth being proportional to traffic and — the bigger point — makes the
 * visitor hashes cease to exist within two days, which settles the salt
 * question above rather than relying on a secret staying secret forever.
 */
const uniques = $entity({
  name: "sigil_uniques_daily",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: sigilId(),
    /**
     * UTC day bucket, `YYYY-MM-DD`.
     */
    day: z.string().min(10).max(10),
    /**
     * A visitor hash, or {@link UNIQUES_COLLAPSED_HASH} on a collapsed row.
     * The sentinel is a single character and every real value is hex, so the
     * two can never collide.
     */
    visitorHash: z.string().min(1).max(128),
    /**
     * `1` on a hash row (one visitor). On a collapsed row, how many distinct
     * visitors that day had.
     *
     * Added with a `DEFAULT`, deliberately: SQLite refuses `ADD COLUMN … NOT
     * NULL` without one on a populated table, and this table has production
     * rows. See `apps/lore/CLAUDE.md`.
     */
    count: db.default(z.integer().min(1), 1),
  }),
  indexes: [
    { columns: ["sigilId", "day", "visitorHash"], unique: true },
    { columns: ["sigilId", "day"] },
  ],
});

/**
 * Web-vitals samples, kept as bucket counts rather than values.
 *
 * A histogram answers the only question worth asking of a performance metric
 * — "what fraction of visits were bad?" — and it answers it at constant
 * storage cost. Keeping raw values would grow with traffic to compute the
 * same percentiles.
 *
 * The bucket boundaries come from `@alepha/sigil`, shared so the
 * chart and the ingest agree on what "good" means.
 *
 * **Seven integer columns, not one JSON blob.** The histogram used to live
 * in a `bucketCounts` JSON column, which meant there was nothing to
 * increment: every sample cost a `findOne` before its `upsert`, and two
 * samples for the same `(hour, metric, path)` arriving together could lose
 * one — a plain read-modify-write race. A column per bucket makes the write
 * `b3 = b3 + excluded.b3` in a single statement: one round-trip, and nothing
 * to lose. The bucket count is fixed, so the width is not a growth risk.
 */
const vitals = $entity({
  name: "sigil_vitals_hourly",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: sigilId(),
    /**
     * UTC hour bucket, `YYYY-MM-DDTHH`.
     */
    hour: z.string().min(13).max(13),
    metric: z.enum(["lcp", "cls", "inp", "fcp", "ttfb"]).meta({ mode: "text" }),
    path: z.string().min(1).max(1024),
    /**
     * One column per bucket index, in the order `bucketIndex` returns. `b6`
     * is the overflow bucket — everything above the last boundary.
     *
     * The defaults are load-bearing twice over: they let a row omit the
     * buckets it has no sample for, and they are what keeps the migration
     * clear of the `ADD COLUMN … NOT NULL` trap on a populated table.
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

export const sigilAnalytics = { views, uniques, vitals };
