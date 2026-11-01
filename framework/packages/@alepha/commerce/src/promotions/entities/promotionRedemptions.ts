import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { promotions } from "./promotions.ts";

/**
 * One use of a promotion by one order.
 *
 * A row rather than a counter on the promotion, for the reason stock is a
 * ledger: a counter read outside the writing transaction lets two buyers take
 * the last use, and this row is also what says who used it. Deleted when the
 * order is cancelled: an order that never happened spent nothing.
 */
export const promotionRedemptions = $entity({
  name: "commerce_promotion_redemptions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),

    promotionId: db.ref(z.uuid(), () => promotions.cols.id),

    /**
     * Plain uuid, like every link to an order from a module beside the core.
     */
    orderId: z.uuid(),

    /**
     * Who used it, for the limit per customer: an account, or the email of a
     * guest.
     */
    userId: z.uuid().optional(),
    email: z.text({ maxLength: 320 }).optional(),
  }),
  indexes: [
    { columns: ["promotionId", "orderId"], unique: true },
    { columns: ["orderId"] },
    { columns: ["userId"] },
    { columns: ["email"] },
  ],
});

export type PromotionRedemptionEntity = Infer<
  typeof promotionRedemptions.schema
>;
