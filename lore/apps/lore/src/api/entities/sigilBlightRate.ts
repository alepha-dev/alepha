import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Per-IP, per-day novelty ledger for the Blights ingestion endpoint.
 *
 * One row per `(sigilId, ipHash, date)` — the day's set of distinct blight
 * fingerprints first seen from that hashed IP. The endpoint caps that set
 * at 10: an 11th NEVER-seen-today fingerprint from an IP that already has
 * 10 is dropped. Repeats of an already-known fingerprint from a capped IP
 * still bump the blight's `count` — the cap is on *novelty intake*, never
 * on throughput (a known blight is allowed to spread freely).
 *
 * DB-derived rate limit (no in-memory window) so it survives restarts and
 * is correct across workers — same discipline as `PetitionRateLimiter`.
 *
 * `ipHash` is `sha256(ip + daily_salt)` — NEVER a raw IP. The daily salt
 * rotates per UTC day, so hashes are not cross-day-linkable.
 *
 * NB on the primary key: folio #10 specifies a composite PK
 * `(sigilId, ipHash, date)`. Alepha's SQLite model builder only honors a
 * single-column `PRIMARY KEY` (see the note in `sigils.ts`), so this table
 * carries a surrogate autoincrement `id` PK and enforces the
 * `(sigilId, ipHash, date)` triple via a UNIQUE index instead — same
 * dedup guarantee, and the upsert's `ON CONFLICT` targets that index.
 *
 * Purely additive `CREATE TABLE` — D1-safe. No FK on `sigilId` on purpose:
 * this is a transient rate-limit ledger, not audit data; rows are
 * short-lived (a day's bucket) and a dangling row after a sigil delete is
 * harmless. Skipping the FK also keeps it off the D1 cascade chain.
 */
export const sigilBlightRate = $entity({
  name: "sigil_blight_rate",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: z.uuid(),
    /** `sha256(ip + daily_salt)`. NEVER a raw IP. */
    ipHash: z.string().min(1).max(128),
    /** UTC day bucket, `YYYY-MM-DD`. */
    date: z.string().min(10).max(10),
    /** Distinct fingerprints first seen today from this IP, capped at 10. */
    fingerprints: db.default(z.array(z.string().max(128)).max(10), []),
  }),
  indexes: [{ columns: ["sigilId", "ipHash", "date"], unique: true }],
});

export type SigilBlightRate = Static<typeof sigilBlightRate.schema>;
export type SigilBlightRateInsert = Static<typeof sigilBlightRate.insertSchema>;
