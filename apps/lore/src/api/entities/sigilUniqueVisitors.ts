import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * Cookieless unique-visitor ledger for the Beacons analytics endpoint
 * (`POST /sigils/:id/beacon`).
 *
 * One row per `(sigilId, date, sessionHash)` — the first ping of the day
 * from a given visitor. The day's unique-visitor count is `COUNT(*)` over
 * `(sigilId, date)`; every ping does an `INSERT OR IGNORE`, so a repeat
 * visit from the same visitor that day is a no-op.
 *
 * `sessionHash = sha256(sigilId + ip + userAgent + daily_salt)` — computed
 * SERVER-SIDE (the client never supplies it). The `daily_salt` rotates per
 * UTC day, so a visitor is NOT linkable across days — GDPR-friendly, no
 * cookie, no persistent identifier. The raw IP is never stored.
 *
 * NB on the primary key: folio #12 specifies a composite PK
 * `(sigilId, date, sessionHash)`. Alepha's SQLite model builder only honors
 * a single-column `PRIMARY KEY` (see `sigils.ts` / `sigilBlightRate.ts`),
 * so this table carries a surrogate autoincrement `id` PK and enforces the
 * triple via a UNIQUE index — the `INSERT OR IGNORE` targets that index.
 *
 * Purely additive `CREATE TABLE` — D1-safe. The `cascade` on `sigilId` only
 * fires when the parent sigil is deleted (and sigils cascade from campaign
 * delete) — same chain as the other sigil-scoped tables.
 */
export const sigilUniqueVisitors = $entity({
  name: "sigil_unique_visitors",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    sigilId: db.ref(t.uuid(), () => sigils.cols.id, {
      onDelete: "cascade",
    }),
    /** UTC day bucket, `YYYY-MM-DD`. */
    date: t.string({ minLength: 10, maxLength: 10 }),
    /**
     * `sha256(sigilId + ip + userAgent + daily_salt)` — server-derived,
     * day-scoped. NEVER a raw IP, never client-supplied.
     */
    sessionHash: t.string({ minLength: 1, maxLength: 128 }),
  }),
  indexes: [
    { columns: ["sigilId", "date", "sessionHash"], unique: true },
    { columns: ["sigilId", "date"] },
  ],
});

export type SigilUniqueVisitor = Static<typeof sigilUniqueVisitors.schema>;
export type SigilUniqueVisitorInsert = Static<
  typeof sigilUniqueVisitors.insertSchema
>;
