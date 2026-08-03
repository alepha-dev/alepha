import { $inject, z } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { orderItems } from "../../entities/orderItems.ts";
import { orderStatusEnum, orders } from "../../entities/orders.ts";
import { OrderService } from "../../services/OrderService.ts";

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
  protected readonly payments = $inject(PaymentService);

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
    description: "Refund the order through the payment rail",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ reason: z.text({ maxLength: 500 }).optional() }),
      response: orders.schema,
    },
    handler: async ({ params, body }) => {
      const order = await this.orders.getById(params.id);

      // The PSP first. If it refuses, the order stays as it was — the customer's
      // money and our record disagreeing is the one outcome to avoid.
      if (order.paymentIntentId) {
        await this.payments.refund(
          order.paymentIntentId,
          order.total,
          body.reason,
        );
      }

      return this.orders.refund(params.id);
    },
  });
}
