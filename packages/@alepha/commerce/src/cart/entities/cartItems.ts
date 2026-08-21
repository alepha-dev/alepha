import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { carts } from "./carts.ts";

/**
 * A line in a basket.
 *
 * Note what is *not* here: a price. A cart line is a reference plus a quantity,
 * and the price is read from the catalog every time the cart is priced. The
 * alternative — snapshotting the price at add-time — means a visitor who left a
 * tab open for a week pays last week's price, and the merchant discovers it
 * from their margin report. The price snapshot belongs on the *order* line,
 * where it is a record of what was actually agreed.
 */
export const cartItems = $entity({
  name: "commerce_cart_items",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    cartId: db.ref(z.uuid(), () => carts.cols.id, { onDelete: "cascade" }),

    /** Plain uuid: deleting a product must not cascade into live carts. */
    productId: z.uuid(),

    quantity: z.integer().min(1),
  }),
  indexes: [
    { columns: ["cartId"] },
    { columns: ["cartId", "productId"], unique: true },
  ],
});

export type CartItemEntity = Infer<typeof cartItems.schema>;
