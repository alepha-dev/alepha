import { z } from "alepha";

/**
 * Order lifecycle.
 *
 * - `pending`   : created, payment not settled.
 * - `paid`      : payment captured; line items have been fulfilled.
 * - `fulfilled` : prepared / packed.
 * - `shipped`   : handed to a carrier.
 * - `delivered` : received by the customer.
 * - `cancelled` : cancelled before fulfilment, nothing owed.
 * - `refunded`  : refunded after payment.
 *
 * Consumers may use a subset: a point-of-sale only ever sees `paid`/`refunded`.
 *
 * ⚠️ In a file of its own, with no ORM import, so the admin's browser bundle
 * can read it: `entities/orders.ts` imports `$entity` from `alepha/orm` at
 * runtime, and the orders table's status filter takes its options from this
 * enum.
 */
export const orderStatusEnum = z.enum([
  "pending",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  /*
   * Appended rather than filed next to `refunded`, because on Postgres this
   * enum becomes a real type and adding a value in the middle of one is a
   * different, heavier statement than adding it at the end.
   *
   * ⚠️ It says something ORTHOGONAL to the rest. `paid`, `shipped` and
   * `delivered` are fulfilment; this one is money. An order that is partially
   * refunded and then shipped reads `shipped`, and the partial refund survives
   * only in `refundedTotal` - which is the field to trust when the two
   * disagree.
   */
  "partially_refunded",
]);
