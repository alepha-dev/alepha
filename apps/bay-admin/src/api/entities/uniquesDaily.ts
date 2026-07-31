import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { pulseApps } from "./pulseApps.ts";

/**
 * One row per visitor per app per day — the cookieless unique count.
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
export const uniquesDaily = $entity({
  name: "uniques_daily",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    appId: db.ref(z.uuid(), () => pulseApps.cols.id, { onDelete: "cascade" }),
    /** UTC day bucket, `YYYY-MM-DD`. */
    day: z.string().min(10).max(10),
    visitorHash: z.string().min(1).max(128),
  }),
  indexes: [
    { columns: ["appId", "day", "visitorHash"], unique: true },
    { columns: ["appId", "day"] },
  ],
});

export type UniqueDaily = Static<typeof uniquesDaily.schema>;
export type UniqueDailyInsert = Static<typeof uniquesDaily.insertSchema>;
