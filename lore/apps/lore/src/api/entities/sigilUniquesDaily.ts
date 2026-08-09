import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { sigils } from "./sigils.ts";

/**
 * One row per visitor per sigil per day — the cookieless unique count.
 *
 * `visitorHash` is computed by the app's own server, the only party that ever
 * sees the IP: `sha256(host + ip + userAgent + dailySalt)`. The raw address
 * never leaves that machine, and the salt rotates every UTC day, which is what
 * makes the value useless as a durable identifier while still counting someone
 * once per day.
 *
 * **`dailySalt` is derived from a secret**, and everything above depends on it.
 * It used to be `sha256("alepha-sigil:" + utcDate)` — the date is public and so
 * was the salt, which made this column a lookup table: one SHA-256 per guess
 * answered "was this IP with this user-agent here today?", and the whole IPv4
 * space was enumerable on a GPU. Rotation and host-scoping were real even then;
 * one-wayness was not. It is now salted with `SIGIL_SALT`, or `SIGIL_KEY` when
 * that is unset. Whether these rows count as aggregate rather than personal
 * data turns entirely on that line staying true — see `SigilProxyController`.
 *
 * No cookie on purpose. An analytics cookie is not "strictly necessary" under
 * ePrivacy, so it would require consent — a banner in every app that reports
 * here. The cost is accuracy: a corporate NAT merges visitors, and someone
 * switching networks counts twice.
 *
 * Rows, not a counter, because "unique" cannot be incremented — you have to
 * know whether you have seen this one today. The count is `COUNT(*)`.
 *
 * **Two row shapes live here.** A *hash row* is the above: one visitor, one
 * day, `count = 1`. A *collapsed row* uses {@link UNIQUES_COLLAPSED_HASH} in
 * place of a hash and carries the day's total in `count`; `SigilJobs` writes
 * one per `(sigilId, day)` about 48 hours after the fact and deletes the hash
 * rows it replaces. Growth then stops being proportional to traffic, and — the
 * bigger point — the visitor hashes cease to exist within two days, which
 * settles the question the paragraph above leaves open rather than relying on
 * the salt to stay secret forever.
 */
/**
 * Stands in for a visitor hash on a collapsed row. A single character, where
 * every real `visitorHash` is a 64-char hex digest — they cannot collide, and
 * the unique index on `(sigilId, day, visitorHash)` gives the collapsed row
 * its uniqueness per `(sigilId, day)` for free.
 */
export const UNIQUES_COLLAPSED_HASH = "*";

export const sigilUniquesDaily = $entity({
  name: "sigil_uniques_daily",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    /** UTC day bucket, `YYYY-MM-DD`. */
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

export type SigilUniqueDaily = Infer<typeof sigilUniquesDaily.schema>;
export type SigilUniqueDailyInsert = Infer<
  typeof sigilUniquesDaily.insertSchema
>;
