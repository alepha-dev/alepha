import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { reservationStatusEnum } from "./stockReservations.ts";

/**
 * A claim on a named resource over an interval: court 3 on Saturday from
 * 18:00, seat 12A on the Lyon leg, room 204 on the night of the 4th.
 *
 * The interval twin of `commerce_stock_reservations`, and the ledger
 * `ResourceService` reads and writes. A claim is one of three things:
 *
 * - a **hold** taken for an order while its payment is in flight (`held`, an
 *   `expiresAt`, an `orderId`)
 * - a **sale**, the same claim once the payment settled (`consumed`, no
 *   expiry)
 * - a **closure** that no sale made: maintenance, a private event, a course
 *   session (`consumed`, no `orderId`, a `label` saying why)
 *
 * All three contend under one rule, which is the point of keeping them in one
 * table.
 */
export const resourceReservations = $entity({
  name: "commerce_resource_reservations",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Opaque. Commerce holds no resource registry and must never learn what a
     * court or a seat is, the same way `orderItems.productId` is a plain uuid.
     */
    resourceId: z.text({ minLength: 1 }),

    /**
     * The interval claimed, half-open: `[startsAt, endsAt)`, so a claim ending
     * at 10:00 and one starting at 10:00 do not overlap.
     *
     * ISO instants in exactly `toISOString()`'s shape, like every other
     * commerce timestamp. They are compared as strings, which is only correct
     * because `ResourceService` normalises every value on the way in. Named
     * `startsAt`/`endsAt` rather than `from`/`to`: `FROM` is a reserved word,
     * and the lock path writes raw SQL.
     */
    startsAt: z.text(),
    endsAt: z.text(),

    /**
     * How much of the resource's capacity this claim takes. The capacity itself
     * is never stored: the caller passes it on every claim, since only the
     * caller knows that a court holds 1 and a course session 12.
     */
    quantity: z.integer().min(1),

    /**
     * The order this claim was taken for. Unset on a closure.
     */
    orderId: z.uuid().optional(),

    /**
     * The order line that took it: what makes a handler idempotent on
     * `item.id`, what matches a commit to its own hold, and what releases one
     * line's claims without touching the others.
     */
    orderItemId: z.uuid().optional(),

    /**
     * Why a claim with no order exists ("maintenance", "Tournoi d'automne").
     * Read by staff through `ResourceService.occupancy`, never by a
     * storefront.
     */
    label: z.text().optional(),

    status: db.default(reservationStatusEnum, "held"),

    /**
     * When a hold stops counting. A `held` claim past this instant is already
     * ineffective, whether or not the sweep has run, so a late sweep delays
     * tidying, it never oversells. Unset on a consumed claim.
     */
    expiresAt: z.text().optional(),
  }),
  indexes: [
    { columns: ["resourceId", "status"] },
    { columns: ["orderId"] },
    { columns: ["orderItemId"] },
    { columns: ["status", "expiresAt"] },
  ],
});

export type ResourceReservationEntity = Infer<
  typeof resourceReservations.schema
>;
