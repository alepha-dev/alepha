import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * Aggregate-on-write pageview counter for the Beacons analytics endpoint
 * (`POST /sigils/:id/beacon`).
 *
 * One row per `(sigilId, date, country, path)` — the day's pageview count
 * for that page from that country. Every ping `INSERT … ON CONFLICT DO
 * UPDATE SET count = count + 1`s into this row instead of storing a row per
 * hit, so storage is bounded by *page cardinality*, not traffic volume.
 *
 * Privacy: `country` is the coarse ISO-3166 code Cloudflare resolves at the
 * edge (`cf-ipcountry`). The raw IP is NEVER stored here or anywhere — see
 * `sigil_unique_visitors` for the cookieless visitor metric.
 *
 * ⚠️ `count` is best-effort by design. The endpoint has no per-IP
 * throughput cap, so the raw number is inflatable; the trustworthy metric
 * is the unique-visitor count. Volume abuse is the Cloudflare WAF's job.
 *
 * NB on the primary key: folio #12 specifies a composite PK
 * `(sigilId, date, country, path)`. Alepha's SQLite model builder only
 * honors a single-column `PRIMARY KEY` (see the note in `sigils.ts` and
 * `sigilBlightRate.ts`), so this table carries a surrogate autoincrement
 * `id` PK and enforces the four-tuple via a UNIQUE index instead — the
 * upsert's `ON CONFLICT` targets that index.
 *
 * Purely additive `CREATE TABLE` — D1-safe. The `cascade` on `sigilId` only
 * fires when the parent sigil is deleted (and sigils cascade from campaign
 * delete) — same chain as the other sigil-scoped tables.
 */
export const sigilViews = $entity({
  name: "sigil_views",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, {
      onDelete: "cascade",
    }),
    /** UTC day bucket, `YYYY-MM-DD`. */
    date: z.string().min(10).max(10),
    /** Coarse ISO-3166 country code from `cf-ipcountry`; `ZZ` when absent. */
    country: z.string().min(1).max(8),
    /** Page path, query + fragment stripped. */
    path: z.string().min(1).max(1_024),
    /** Pageview count for this `(sigilId, date, country, path)` tuple. */
    count: db.default(z.integer().min(1), 1),
  }),
  indexes: [
    { columns: ["sigilId", "date", "country", "path"], unique: true },
    { columns: ["sigilId", "date"] },
  ],
});

export type SigilView = Static<typeof sigilViews.schema>;
export type SigilViewInsert = Static<typeof sigilViews.insertSchema>;
