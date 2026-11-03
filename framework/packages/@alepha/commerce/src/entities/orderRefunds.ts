import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One line of a refund: so many units of an order line.
 */
export const refundLineSchema = z.object({
  orderItemId: z.uuid(),
  quantity: z.integer().min(1),
});

export type RefundLine = Infer<typeof refundLineSchema>;

/**
 * - `pending`: asked for, the payment rail has not confirmed it.
 * - `done`: the money moved, and `orders.refundedTotal` says so.
 */
export const orderRefundStatusEnum = z.enum(["pending", "done"]);

/**
 * One refund on an order: how much, of what, and why.
 *
 * `orders.refundedTotal` is a sum, mirrored from the payment rail, and a sum
 * cannot say what a credit note has to: which lines came back and for what
 * reason. And the rail's own event knows neither, so the back office writes this
 * row `pending` before it asks the rail, and `OrderService.refund` completes it
 * when the money has moved. A refund made on the PSP's dashboard arrives with no
 * row behind it, and gets one at that point, with an amount and nothing else.
 *
 * What the credit note job is keyed on, and what makes it idempotent.
 */
export const orderRefunds = $entity({
  name: "commerce_order_refunds",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Plain uuid: a refund is a record of money, and outlives the order row.
     */
    orderId: z.uuid(),

    /**
     * What this refund gave back, tax included.
     */
    amount: z.integer().min(1),

    reason: z.text({ maxLength: 500 }).optional(),

    /**
     * Empty for a refund by amount.
     */
    lines: db.default(z.array(refundLineSchema), []),

    status: db.default(orderRefundStatusEnum, "pending"),

    /**
     * The credit note issued for it. Set once, which is what stops a retried
     * job from issuing a second.
     */
    creditNoteId: z.uuid().optional(),
  }),
  indexes: [{ columns: ["orderId"] }, { columns: ["status"] }],
});

export type OrderRefundEntity = Infer<typeof orderRefunds.schema>;
