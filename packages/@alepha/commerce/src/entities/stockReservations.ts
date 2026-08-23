import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * What became of a hold.
 */
export const reservationStatusEnum = z.enum(["held", "consumed", "released"]);

/**
 * A temporary hold on stock, taken while a payment is in flight.
 *
 * ### Why a hold and not just a decrement
 *
 * Decrementing at checkout means an abandoned basket silently destroys stock
 * until someone notices. Decrementing at settlement means two buyers can both
 * reach the payment page for the last ring, and the loser pays for something
 * that does not exist — a refund, an apology, and a bad review.
 *
 * A hold is the answer: it makes the unit unavailable to everyone else, and it
 * expires by itself if the payment never lands.
 *
 * Kept separate from `commerce_stock_movements` because a hold is not a
 * movement: nothing has physically left the drawer. On-hand stays the sum of
 * movements; what a storefront shows is on-hand minus live holds.
 */
export const stockReservations = $entity({
  name: "commerce_stock_reservations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),

    productId: z.uuid(),
    quantity: z.integer().min(1),

    /**
     * The order this hold was taken for.
     */
    orderId: z.uuid(),

    status: db.default(reservationStatusEnum, "held"),

    /**
     * When the hold stops counting. A `held` row past this instant is already
     * ineffective for availability, whether or not the sweep has run — so a
     * late sweep delays cleanup, it never oversells.
     */
    expiresAt: z.text(),
  }),
  indexes: [
    { columns: ["organizationId", "productId", "status"] },
    { columns: ["orderId"] },
    { columns: ["status", "expiresAt"] },
  ],
});

export type StockReservationEntity = Infer<typeof stockReservations.schema>;
