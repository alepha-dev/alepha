import { type Static, z } from "alepha";
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
 * No cookie on purpose. An analytics cookie is not "strictly necessary" under
 * ePrivacy, so it would require consent — a banner in every app that reports
 * here. The cost is accuracy: a corporate NAT merges visitors, and someone
 * switching networks counts twice.
 *
 * Rows, not a counter, because "unique" cannot be incremented — you have to
 * know whether you have seen this one today. The count is `COUNT(*)`.
 */
export const sigilUniquesDaily = $entity({
  name: "sigil_uniques_daily",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
    /** UTC day bucket, `YYYY-MM-DD`. */
    day: z.string().min(10).max(10),
    visitorHash: z.string().min(1).max(128),
  }),
  indexes: [
    { columns: ["sigilId", "day", "visitorHash"], unique: true },
    { columns: ["sigilId", "day"] },
  ],
});

export type SigilUniqueDaily = Static<typeof sigilUniquesDaily.schema>;
export type SigilUniqueDailyInsert = Static<
  typeof sigilUniquesDaily.insertSchema
>;
