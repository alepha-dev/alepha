import { $inject, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError } from "alepha/server";

import { refundLineSchema } from "../entities/orderRefunds.ts";
import { publicOrderItemSchema } from "../schemas/publicOrderItemSchema.ts";
import { publicOrderSchema } from "../schemas/publicOrderSchema.ts";
import { publicReturnSchema } from "../schemas/publicReturnSchema.ts";
import { OrderService } from "../services/OrderService.ts";
import { ReturnService } from "../services/ReturnService.ts";

/**
 * A customer's own orders.
 *
 * Every route is scoped to the signed-in user and re-checks ownership on the
 * detail route. Scoping the list is not enough on its own: the detail route takes
 * an id, and a uuid is not a secret - without the check, any signed-in customer
 * could read anyone's order by guessing one.
 */
export class OrderController {
  protected readonly url = "/commerce/orders";
  protected readonly group = "commerce:orders";
  protected readonly orders = $inject(OrderService);
  protected readonly returns = $inject(ReturnService);

  public readonly commerceOrderMine = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure()],
    description: "List the signed-in customer's orders",
    schema: {
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
      }),
      response: db.page(publicOrderSchema),
    },
    handler: async ({ query, user }) => this.orders.listForUser(user.id, query),
  });

  public readonly commerceOrderDetail = $action({
    method: "GET",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure()],
    description: "Read one of the signed-in customer's orders",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.object({
        order: publicOrderSchema,
        items: z.array(publicOrderItemSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const order = await this.ownOrder(params.id, user.id);
      return { order, items: await this.orders.itemsOf(order.id) };
    },
  });

  /**
   * Ask to send part of an order back, within the withdrawal period.
   */
  public readonly commerceOrderReturnRequest = $action({
    method: "POST",
    path: `${this.url}/:id/returns`,
    group: this.group,
    use: [$secure()],
    description: "Request a return on one of the signed-in customer's orders",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        lines: z.array(refundLineSchema).min(1),
        reason: z.text({ maxLength: 500 }).optional(),
      }),
      response: publicReturnSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.ownOrder(params.id, user.id);
      return this.returns.request(params.id, body);
    },
  });

  public readonly commerceOrderReturns = $action({
    method: "GET",
    path: `${this.url}/:id/returns`,
    group: this.group,
    use: [$secure()],
    description: "List the returns of one of the signed-in customer's orders",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: z.array(publicReturnSchema),
    },
    handler: async ({ params, user }) => {
      await this.ownOrder(params.id, user.id);
      return this.returns.listForOrder(params.id);
    },
  });

  protected async ownOrder(id: string, userId: string) {
    const order = await this.orders.getById(id);
    if (order.userId !== userId) {
      // Deliberately not "not found": the caller is authenticated and this is
      // a real order, it is simply not theirs.
      throw new ForbiddenError("This order does not belong to you.");
    }
    return order;
  }
}
