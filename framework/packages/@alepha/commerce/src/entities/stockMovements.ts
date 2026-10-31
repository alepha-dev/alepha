import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Why stock moved.
 */
export const stockReasonEnum = z.enum([
  "intake",
  "sale",
  "return",
  "adjustment",
]);

/**
 * Append-only stock ledger. On-hand is the sum of a product's deltas - never a
 * counter column.
 *
 * A counter read outside the writing transaction is what lets two concurrent
 * sales both pass the same "enough stock?" check and oversell. Summing inside
 * the transaction that writes the movement closes that window.
 */
export const stockMovements = $entity({
  name: "commerce_stock_movements",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    productId: z.uuid(),

    /**
     * The variant that moved, on a product sold by variant. The product's
     * on-hand is the sum across them.
     */
    variantId: z.uuid().optional(),

    /**
     * Signed: negative for a sale, positive for an intake or a return.
     */
    delta: z.integer(),

    reason: stockReasonEnum,

    /**
     * Set when the movement was caused by an order.
     */
    orderId: z.uuid().optional(),

    /**
     * The order line behind the movement: what makes a sale idempotent per
     * line, since one order can carry a product on two lines.
     */
    orderItemId: z.uuid().optional(),

    note: z.text({ maxLength: 500 }).optional(),
  }),
  indexes: [
    { columns: ["productId"] },
    { columns: ["variantId"] },
    { columns: ["orderId"] },
  ],
});

export type StockMovementEntity = Infer<typeof stockMovements.schema>;
