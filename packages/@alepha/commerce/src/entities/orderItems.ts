import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";
import { orders } from "./orders.ts";

/**
 * One line of an order.
 *
 * Price and kind are **snapshotted** at order time: the catalog can be edited
 * or a product deleted afterwards, and the order must still say what was sold
 * and for how much. `kind` is copied so fulfilment can be replayed without
 * re-reading the product row.
 */
export const orderItems = $entity({
  name: "commerce_order_items",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),

    orderId: db.ref(z.uuid(), () => orders.cols.id, { onDelete: "cascade" }),

    /**
     * Plain uuid, not a `db.ref` to `products`: deleting a product must never
     * cascade into historical orders, and the snapshot below is what the order
     * actually relies on.
     */
    productId: z.uuid(),

    /** Snapshots — see the class note above. */
    kind: z.text({ maxLength: 64 }),
    name: z.text({ maxLength: 200 }),
    unitPrice: z.integer().min(0),

    /**
     * The product's VAT rate at order time, in basis points. Unset means the
     * seller's default applied.
     *
     * Snapshotted for the same reason as the price: a rate can be corrected in
     * the catalog, or changed by law, and an invoice already issued has to keep
     * showing the rate it was actually computed with.
     */
    rateBps: z.integer().min(0).max(10000).optional(),

    quantity: z.integer().min(1),

    /** The product's `config` at order time — what `fulfil` consumes. */
    config: z.json().optional(),
  }),
  indexes: [{ columns: ["orderId"] }, { columns: ["productId"] }],
});

export type OrderItemEntity = Infer<typeof orderItems.schema>;
