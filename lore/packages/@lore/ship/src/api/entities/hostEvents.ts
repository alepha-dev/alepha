import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { hosts } from "./hosts.ts";

/**
 * What happened on a machine, as it told Lore (`event` frames): a backup run,
 * the bucket going down and back, a restore, a restore test. The console's
 * backup timeline reads these.
 *
 * A leaf: nothing points at it, and it goes with its host. Bounded per
 * host by `HostEventService.KEEP_PER_HOST`, oldest first, because a
 * machine decides how often it speaks. `eventId` is the machine's own id,
 * unique per host, so the redelivery after a reconnect is a no-op.
 */
export const hostEvents = $entity({
  name: "host_events",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    hostId: db.ref(z.uuid(), () => hosts.cols.id, {
      onDelete: "cascade",
    }),
    eventId: z.string().max(64),
    kind: z.string().max(64),
    /** The machine's instance name and environment; absent machine-wide. */
    app: z.string().max(100).optional(),
    env: z.string().max(100).optional(),
    /** When it happened, on the machine's clock. */
    at: z.string().max(40),
    data: z.record(z.string(), z.any()).optional(),
  }),
  indexes: [
    { columns: ["hostId", "eventId"], unique: true },
    { columns: ["hostId", "app", "env", "at"] },
  ],
});

export type HostEvent = Infer<typeof hostEvents.schema>;
