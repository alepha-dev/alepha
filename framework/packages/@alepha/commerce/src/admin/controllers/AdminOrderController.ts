import { $inject, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { orderItems } from "../../entities/orderItems.ts";
import { refundLineSchema } from "../../entities/orderRefunds.ts";
import { orders } from "../../entities/orders.ts";
import { orderStatusEnum } from "../../schemas/orderStatusSchema.ts";
import { OrderService } from "../../services/OrderService.ts";
import { OrderRefundService } from "../services/OrderRefundService.ts";

/**
 * Order management: see them, ship them, refund them.
 *
 * Refunding goes through the payment rail first and only then through the domain,
 * so a PSP refusal leaves the order untouched. The reverse order would mark an
 * order refunded that the customer was never paid back for.
 */
export class AdminOrderController {
  protected readonly url = "/admin/commerce/orders";
  protected readonly group = "admin:commerce:orders";
  protected readonly orders = $inject(OrderService);
  protected readonly refunds = $inject(OrderRefundService);

  public readonly commerceAdminOrderList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List orders, newest first",
    schema: {
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
        status: orderStatusEnum.optional(),
        /**
         * A piece of the order number.
         */
        q: z.text({ maxLength: 40 }).optional(),
      }),
      response: db.page(orders.schema),
    },
    handler: async ({ query }) => this.orders.list(query),
  });

  public readonly commerceAdminOrderDetail = $action({
    method: "GET",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "Read an order with its lines",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({
        order: orders.schema,
        items: z.array(orderItems.schema),
      }),
    },
    handler: async ({ params }) => ({
      order: await this.orders.getById(params.id),
      items: await this.orders.itemsOf(params.id),
    }),
  });

  public readonly commerceAdminOrderShip = $action({
    method: "POST",
    path: `${this.url}/:id/ship`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Hand the order to a carrier",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        trackingNumber: z.text({ maxLength: 64 }).optional(),
        trackingUrl: z.text({ maxLength: 500 }).optional(),
      }),
      response: orders.schema,
    },
    handler: async ({ params, body }) =>
      this.orders.markShipped(params.id, body),
  });

  public readonly commerceAdminOrderDeliver = $action({
    method: "POST",
    path: `${this.url}/:id/deliver`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Mark the order received by the customer",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: orders.schema,
    },
    handler: async ({ params }) => this.orders.markDelivered(params.id),
  });

  public readonly commerceAdminOrderRefund = $action({
    method: "POST",
    path: `${this.url}/:id/refund`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:refund"] })],
    description:
      "Refund an order through the payment rail: some lines, an amount, or what is left",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        reason: z.text({ maxLength: 500 }).optional(),
        /**
         * Tax included. Ignored when `lines` is set.
         */
        amount: z.integer().min(1).optional(),
        lines: z.array(refundLineSchema).optional(),
      }),
      response: orders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.getById(params.id);

      // Nothing narrower asked for, and nothing left to give: a second click
      // on Refund, which is not an error worth an operator's time.
      if (
        order.refundedTotal >= order.total &&
        !body.amount &&
        !body.lines?.length
      ) {
        return order;
      }

      // Everything left when nothing narrower was asked for: on an order that
      // already had part of it back, the rail refuses the whole total.
      const { order: refunded } = await this.refunds.refund(params.id, body);
      return refunded;
    },
  });

  /**
   * Take lines off a paid order that has not left: the money goes back, the
   * parcel gets lighter, the units go back on the shelf. The money first, for
   * the reason a refund is.
   */
  public readonly commerceAdminOrderCancelLines = $action({
    method: "POST",
    path: `${this.url}/:id/cancel-lines`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:refund"] })],
    description: "Cancel lines of an order that has not shipped",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        lines: z.array(refundLineSchema).min(1),
        reason: z.text({ maxLength: 500 }).optional(),
      }),
      response: orders.schema,
    },
    handler: async ({ params, body }) => {
      await this.orders.assertUnshipped(params.id);
      const { order } = await this.refunds.refund(params.id, body);
      await this.orders.cancelLines(params.id, body.lines);
      return order;
    },
  });
}
