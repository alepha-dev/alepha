import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/** Why stock moved. */
export const stockReasonEnum = z.enum([
  "intake",
  "sale",
  "return",
  "adjustment",
]);

/**
 * Append-only stock ledger. On-hand is the sum of a product's deltas — never a
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
    organizationId: db.organization(),

    productId: z.uuid(),

    /** Signed: negative for a sale, positive for an intake or a return. */
    delta: z.integer(),

    reason: stockReasonEnum,

    /** Set when the movement was caused by an order. */
    orderId: z.uuid().optional(),

    note: z.text({ maxLength: 500 }).optional(),
  }),
  indexes: [
    { columns: ["organizationId", "productId"] },
    { columns: ["orderId"] },
  ],
});

export type StockMovementEntity = Infer<typeof stockMovements.schema>;
