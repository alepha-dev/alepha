import { z } from "alepha";

/**
 * Where a return has got to.
 *
 * - `requested`: the customer asked; nothing has come back.
 * - `received`: the parcel is here, and what can be sold again is back in stock.
 * - `refunded`: the money went back.
 * - `refused`: the shop said no.
 *
 * In a file of its own, with no ORM import, so the admin's browser bundle can
 * read it, like `orderStatusEnum`.
 */
export const orderReturnStatusSchema = z.enum([
  "requested",
  "received",
  "refunded",
  "refused",
]);
