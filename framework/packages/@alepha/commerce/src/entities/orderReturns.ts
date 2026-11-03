import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

import { orderReturnStatusSchema } from "../schemas/orderReturnStatusSchema.ts";
import { refundLineSchema } from "./orderRefunds.ts";

/**
 * A customer sending part of an order back.
 *
 * Kept apart from the refund, which it usually ends in and does not have to: a
 * return can be refused, a parcel can come back with nothing owed, and a refund
 * needs no return. Each transition is one the shop makes on purpose, since the
 * parcel arrives days after the request, and only somebody who opened it can say
 * what can be sold again.
 */
export const orderReturns = $entity({
  name: "commerce_order_returns",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Plain uuid, like every record of what happened to an order.
     */
    orderId: z.uuid(),

    status: db.default(orderReturnStatusSchema, "requested"),

    /**
     * What the customer is sending back.
     */
    lines: z.array(refundLineSchema),

    /**
     * The customer's own words.
     */
    reason: z.text({ maxLength: 500 }).optional(),

    /**
     * The shop's, on a refusal.
     */
    note: z.text({ maxLength: 500 }).optional(),

    receivedAt: z.text().optional(),

    /**
     * The refund that closed it.
     */
    refundId: z.uuid().optional(),
  }),
  indexes: [{ columns: ["orderId"] }, { columns: ["status"] }],
});

export type OrderReturnEntity = Infer<typeof orderReturns.schema>;
export type OrderReturnStatus = OrderReturnEntity["status"];
