import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { monitors } from "./monitors.ts";

/**
 * Individual checks for the beat bar, retained as a bounded tail.
 */
export const monitorHeartbeats = $entity({
  name: "monitor_heartbeats",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    monitorId: db.ref(z.uuid(), () => monitors.cols.id, {
      onDelete: "cascade",
    }),
    at: z.string(),
    ok: z.boolean(),
    latencyMs: z.integer().min(0),
    error: z.string().max(4096).optional(),
  }),
  indexes: [{ columns: ["monitorId", "at"] }],
});
