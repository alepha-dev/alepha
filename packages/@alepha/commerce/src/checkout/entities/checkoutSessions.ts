import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Where a checkout has got to.
 *
 * - `open`      — collecting details.
 * - `paying`    — an order and a payment intent exist; awaiting settlement.
 * - `completed` — the payment settled and the order is paid.
 * - `abandoned` — expired or explicitly given up on.
 */
export const checkoutStatusEnum = z.enum([
  "open",
  "paying",
  "completed",
  "abandoned",
]);

/**
 * One attempt at turning a cart into an order.
 *
 * ### Why this table exists at all
 *
 * The checkout module cannot add columns to `commerce_orders` — entities are
 * code and migrations are per-app, so a module cannot reach into another
 * module's table. So it keeps its own: the address being collected, the
 * shipping choice, the computed totals all live here while they are still in
 * flux, and only the generic fields are copied onto the order once it settles.
 *
 * That constraint turns out to be the right design anyway. An abandoned
 * checkout is not a half-written order, and a customer who changes their
 * address twice should not leave two versions of an order behind.
 */
export const checkoutSessions = $entity({
  name: "commerce_checkout_sessions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    /**
     * Plain uuid: a cart may be swept while an abandoned checkout lingers.
     */
    cartId: z.uuid(),

    userId: z.uuid().optional(),

    status: db.default(checkoutStatusEnum, "open"),

    email: z.text({ maxLength: 320 }).optional(),

    /**
     * Opaque while in flux — the shape is region-specific.
     */
    shippingAddress: z.json().optional(),

    /**
     * Indexable choice; the carrier's own payload stays in the blob above.
     */
    shippingMethod: z.text({ maxLength: 64 }).optional(),

    /**
     * Totals as last computed. Recomputed before the order is created.
     */
    subtotal: db.default(z.integer().min(0), 0),
    shippingTotal: db.default(z.integer().min(0), 0),
    taxTotal: db.default(z.integer().min(0), 0),
    grandTotal: db.default(z.integer().min(0), 0),
    currency: db.default(z.text({ minLength: 3, maxLength: 3 }), "EUR"),

    /**
     * Set once {@link CheckoutService.pay} has run.
     */
    orderId: z.uuid().optional(),
    paymentIntentId: z.text().optional(),
  }),
  indexes: [
    { columns: ["organizationId"] },
    { columns: ["cartId"] },
    { columns: ["organizationId", "status"] },
    { columns: ["orderId"] },
  ],
});

export type CheckoutSessionEntity = Infer<typeof checkoutSessions.schema>;
