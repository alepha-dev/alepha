import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { estates } from "./estates.ts";

/**
 * What happened on a machine, as it told Lore (`event` frames): a backup run,
 * the bucket going down and back, a restore, a restore test. The console's
 * backup timeline reads these.
 *
 * A leaf: nothing points at it, and it goes with its estate. Bounded per
 * estate by `EstateEventService.KEEP_PER_ESTATE`, oldest first, because a
 * machine decides how often it speaks. `eventId` is the machine's own id,
 * unique per estate, so the redelivery after a reconnect is a no-op.
 */
export const estateEvents = $entity({
  name: "estate_events",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    estateId: db.ref(z.uuid(), () => estates.cols.id, {
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
    { columns: ["estateId", "eventId"], unique: true },
    { columns: ["estateId", "app", "env", "at"] },
  ],
});

export type EstateEvent = Infer<typeof estateEvents.schema>;
