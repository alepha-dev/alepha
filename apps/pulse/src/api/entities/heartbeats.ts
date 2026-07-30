import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { pulseApps } from "./pulseApps.ts";

/**
 * The last sign of life from each app. One row per app, overwritten.
 *
 * No history: whether an app was up an hour ago is answered by its metrics
 * series, and keeping every heartbeat would be a second copy of the same fact.
 *
 * Up/down is **derived here**, from silence — an app never claims to be
 * healthy, because an app that has stopped cannot tell you so. For an app Bay
 * hosts, this is crossed with the supervisor's `running`, which is what tells a
 * deliberate stop apart from a crash.
 */
export const heartbeats = $entity({
  name: "heartbeats",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    appId: db.ref(z.uuid(), () => pulseApps.cols.id, { onDelete: "cascade" }),
    lastSeenAt: z.string(),
    release: z.string().max(200).optional(),
    uptimeSec: z.number().optional(),
    /** The app's own hint that nothing is in flight. Never a health signal. */
    idle: z.boolean().optional(),
  }),
  indexes: [{ columns: ["appId"], unique: true }],
});

export type Heartbeat = Static<typeof heartbeats.schema>;
export type HeartbeatInsert = Static<typeof heartbeats.insertSchema>;
