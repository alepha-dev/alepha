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
 *
 * ### The line carries the offer
 *
 * Two lines of one product can differ: "Padel, 90 minutes" on court 2 on
 * Saturday at 18:00 and on court 5 on Sunday at 10:00 are one product and two
 * lines. What differs lives in {@link lineConfig}, and the unique index is
 * `(cartId, productId, lineKey)` so that two adds of the same `good`, or of the
 * same slot, still merge into one line under the database's own guarantee.
 *
 * This is not a separate `offers` table, and a cart line holds nothing. An
 * offer's job is to freeze a price and to hold the resource: the order line
 * freezes the price, and the hold is taken when `pay()` creates the order
 * pending, exactly as for stock. A slot lost between the cart and `pay()` is
 * a 409 the storefront shows after re-reading availability. An `offers` table
 * earns its place when pricing is expensive to compute or quoted-versus-sold
 * has to be auditable (airlines need one because offers are shopped across
 * distributors); a single shop or club has neither problem, and a second
 * expiry mechanism for the same hold would be one more thing to drift.
 */
export const cartItems = $entity({
  name: "commerce_cart_items",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    cartId: db.ref(z.uuid(), () => carts.cols.id, { onDelete: "cascade" }),

    /**
     * Plain uuid: deleting a product must not cascade into live carts.
     */
    productId: z.uuid(),

    quantity: z.integer().min(1),

    /**
     * What this line chooses beyond the product, validated by the kind's
     * `lineSchema` and `validateLine` before it is written. Unset for a kind
     * that takes none, such as `good`.
     */
    lineConfig: z.json().optional(),

    /**
     * The sha-256 of the canonical JSON of {@link lineConfig}, or `""` when
     * there is none: the third column of the unique index.
     *
     * Never NULL, because SQLite treats NULLs as distinct in a UNIQUE index
     * and two adds of one `good` would make two lines. A hash rather than the
     * JSON itself because `z.text()` caps at 255.
     */
    lineKey: db.default(z.text({ maxLength: 64 }), ""),
  }),
  indexes: [
    { columns: ["cartId"] },
    { columns: ["cartId", "productId", "lineKey"], unique: true },
  ],
});

export type CartItemEntity = Infer<typeof cartItems.schema>;
