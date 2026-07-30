import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { pulseApps } from "./pulseApps.ts";

/**
 * Error groups waiting to reach Lore.
 *
 * Written before the request and deleted on acknowledgement, so a Lore that is
 * down — or a key mid-rotation — costs a retry rather than a lost report. The
 * alternative, forwarding straight from the job, silently drops exactly the
 * batch that was in flight when something broke.
 *
 * `attempts` and `lastError` exist to be looked at: a row that has failed
 * fifteen times is a configuration problem, and it should be visible as one
 * instead of as an empty inbox.
 */
export const loreOutbox = $entity({
  name: "lore_outbox",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    appId: db.ref(z.uuid(), () => pulseApps.cols.id, { onDelete: "cascade" }),
    /** The batch, already shaped as Lore's ingest body. Capped by the sender. */
    payload: z.record(z.string(), z.any()),
    createdAt: db.createdAt(),
    attempts: db.default(z.integer().min(0), 0),
    lastError: z.string().max(2000).optional(),
  }),
  indexes: [{ columns: ["appId", "createdAt"] }],
});

export type LoreOutboxRow = Static<typeof loreOutbox.schema>;
export type LoreOutboxInsert = Static<typeof loreOutbox.insertSchema>;
