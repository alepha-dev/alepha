import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { monitors } from "./monitors.ts";

/**
 * Exact outage boundaries, independent of the hourly analytics buckets.
 */
export const monitorIncidents = $entity({
  name: "monitor_incidents",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    monitorId: db.ref(z.uuid(), () => monitors.cols.id, {
      onDelete: "cascade",
    }),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    cause: z.string().max(50),
    lastError: z.string().max(4096).optional(),
  }),
  indexes: [{ columns: ["monitorId", "startedAt"] }],
});

export type MonitorIncident = Infer<typeof monitorIncidents.schema>;
