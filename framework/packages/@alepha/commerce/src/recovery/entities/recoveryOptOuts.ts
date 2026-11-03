import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * An address that asked for no more reminders.
 *
 * By email rather than by checkout, because that is what the person asked for:
 * a later checkout with the same address is the same person, whatever box it
 * ticks. Kept for as long as the shop sends reminders, which is what the
 * opt-out means.
 */
export const recoveryOptOuts = $entity({
  name: "commerce_recovery_opt_outs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),

    /**
     * Lower case, so a capital in an address cannot slip past it.
     */
    email: z.text({ maxLength: 320 }),
  }),
  indexes: [{ columns: ["email"], unique: true }],
});

export type RecoveryOptOutEntity = Infer<typeof recoveryOptOuts.schema>;
