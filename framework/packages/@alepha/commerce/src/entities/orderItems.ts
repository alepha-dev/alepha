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

    /**
     * The variant sold, on a product sold by variant. Plain uuid, like
     * `productId`.
     */
    variantId: z.uuid().optional(),

    /**
     * Snapshots — see the class note above.
     */
    kind: z.text({ maxLength: 64 }),
    name: z.text({ maxLength: 200 }),
    sku: z.text({ maxLength: 64 }).optional(),
    /**
     * The variant's option values as the buyer read them: `Bleu / M`.
     */
    variantLabel: z.text({ maxLength: 200 }).optional(),
    unitPrice: z.integer().min(0),

    /**
     * This line's share of the order's discount, tax included. What the line
     * cost the buyer is `unitPrice * quantity - discount`: the base its VAT is
     * computed on, and what refunding it gives back.
     */
    discount: db.default(z.integer().min(0), 0),

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

    /**
     * How many units a refund by line has given back. The money itself is
     * `orders.refundedTotal`.
     */
    refundedQuantity: db.default(z.integer().min(0), 0),

    /**
     * How many units were cancelled before shipping: what the parcel will not
     * hold.
     */
    cancelledQuantity: db.default(z.integer().min(0), 0),

    /**
     * The product's `config` at order time — what `fulfil` consumes.
     */
    config: z.json().optional(),

    /**
     * The buyer's line config, validated by the kind's handler: which court
     * and when, for a resource kind. Kept apart from {@link config}, which is
     * the merchant's, so a buyer's line can never override a product's keys.
     */
    lineConfig: z.json().optional(),
  }),
  indexes: [{ columns: ["orderId"] }, { columns: ["productId"] }],
});

export type OrderItemEntity = Infer<typeof orderItems.schema>;
