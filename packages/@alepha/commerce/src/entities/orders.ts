import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Order lifecycle.
 *
 * - `pending`   — created, payment not settled.
 * - `paid`      — payment captured; line items have been fulfilled.
 * - `fulfilled` — prepared / packed.
 * - `shipped`   — handed to a carrier.
 * - `delivered` — received by the customer.
 * - `cancelled` — cancelled before fulfilment, nothing owed.
 * - `refunded`  — refunded after payment.
 *
 * Consumers may use a subset: a point-of-sale only ever sees `paid`/`refunded`.
 */
export const orderStatusEnum = z.enum([
  "pending",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

/**
 * The settled record of a sale.
 *
 * ### Why this table stays generic
 *
 * `@alepha/commerce/checkout` and `@alepha/commerce/shipping` cannot add
 * columns here. They keep their own tables and write only into the generic
 * fields below at the moment the order settles. `shippingMethod` is the one
 * indexable field pulled up to the core, because "every order shipped by X
 * this month" is a real query; the carrier's own payload stays in
 * `shippingAddress`, unqueryable and deliberately so.
 */
export const orders = $entity({
  name: "commerce_orders",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    /**
     * Buyer. Optional — a walk-in sale is anonymous.
     */
    userId: z.uuid().optional(),

    status: orderStatusEnum,

    /**
     * **What the customer pays** — items plus delivery, in the smallest currency
     * unit. Not the line-item sum.
     *
     * The distinction is not pedantic: an order whose `total` excluded delivery
     * while the payment charged it produced a shop that said 89,00 € and a card
     * statement that said 95,90 €. A test caught it; the field's meaning is
     * pinned here so it cannot come back.
     */
    total: z.integer().min(0),

    /**
     * Delivery charged, already included in {@link total}.
     */
    shippingTotal: db.default(z.integer().min(0), 0),

    /**
     * VAT contained in {@link total}. Prices are tax-inclusive (the EU B2C
     * display requirement), so this is extracted, never added.
     */
    taxTotal: db.default(z.integer().min(0), 0),

    currency: db.default(z.text({ minLength: 3, maxLength: 3 }), "EUR"),

    /**
     * Set once the payment rail hands back a reference. Plain text, not a
     * `db.ref` to `paymentIntents` — a ref would make this module depend on
     * `alepha/api/payments` at the schema level, and the payment rail is
     * substitutable.
     */
    paymentIntentId: z.text().optional(),

    /**
     * Indexable shipping choice. Carrier detail lives in the address blob.
     */
    shippingMethod: z.text({ maxLength: 64 }).optional(),

    /**
     * Carrier's consignment number, once handed over.
     */
    trackingNumber: z.text({ maxLength: 64 }).optional(),
    /**
     * Where the buyer follows the parcel.
     */
    trackingUrl: z.text({ maxLength: 500 }).optional(),

    shippedAt: z.text().optional(),
    deliveredAt: z.text().optional(),

    /**
     * Address shape varies by region — kept opaque on purpose.
     */
    shippingAddress: z.json().optional(),

    notes: z.text({ maxLength: 2000 }).optional(),
  }),
  indexes: [
    { columns: ["organizationId"] },
    { columns: ["organizationId", "status"] },
    { columns: ["organizationId", "userId"] },
    { columns: ["organizationId", "createdAt"] },
  ],
});

export type OrderEntity = Infer<typeof orders.schema>;
export type OrderStatus = OrderEntity["status"];
