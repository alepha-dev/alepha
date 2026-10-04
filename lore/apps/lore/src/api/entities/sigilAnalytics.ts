import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { sigils } from "./sigils.ts";

/**
 * Stands in for a visitor hash on a collapsed uniques row. A single character,
 * where every real `visitorHash` is a 64-char hex digest — they cannot
 * collide, and the unique index on `(sigilId, day, visitorHash)` gives the
 * collapsed row its uniqueness per `(sigilId, day)` for free.
 */
export const UNIQUES_COLLAPSED_HASH = "*";

/**
 * The sigil aggregate table that is still Lore's own: daily unique visitors.
 *
 * Views and vitals moved onto the `LoreAnalytics` `$analytics()` datasets, and
 * their hourly tables were dropped (#E74). Uniques cannot follow them: a
 * distinct count survives neither sampling nor a rollup, so it stays a table
 * here, read and written by `LoreAnalyticsStore` and collapsed by `SigilJobs`.
 *
 * It references `sigils`, this app's entity, which is why the schema lives in
 * `apps/lore` rather than in `@alepha/lore`: storage is not protocol.
 *
 * The cascade is load-bearing and is why dropping the ref for a plain uuid was
 * rejected: deleting a sigil erases everything it ever reported, which is
 * exactly why the UI tells the operator to **rotate** rather than delete.
 *
 * `sigilUniquesDaily.ts` re-exports the entity, so the file-per-entity
 * convention survives.
 */
const sigilId = () =>
  db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" });

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
    /**
     * `human` | `bot`, as the app's own proxy classified the user-agent.
     *
     * Defaulted for the same reason `count` is - this table has production
     * rows and SQLite refuses `ADD COLUMN … NOT NULL` without a default - and
     * `human` is also the right value for every row written before the
     * dimension existed: they were not classified, and unclassified is a
     * person. See `sigilTrafficKind` for why the tie never goes the other way.
     */
    traffic: db.default(z.string().min(1).max(16), "human"),
  }),
  indexes: [
    /**
     * `traffic` is IN the unique index, and it has to be.
     *
     * A hash row would not need it: `visitorHash` closes over the user-agent
     * and `traffic` is derived from that same user-agent, so one hash can only
     * ever carry one traffic kind. The proxy is the only writer, which is what
     * makes that hold.
     *
     * The collapsed rows are what force it. A collapsed row stands in for a
     * whole day with {@link UNIQUES_COLLAPSED_HASH} where its hash would be,
     * and a day now needs one per traffic kind - two rows sharing
     * `(sigilId, day, '*')`. Without `traffic` in the index they collide and
     * the sweep cannot write the second.
     */
    { columns: ["sigilId", "day", "visitorHash", "traffic"], unique: true },
    { columns: ["sigilId", "day"] },
  ],
});

export const sigilAnalytics = { uniques };
