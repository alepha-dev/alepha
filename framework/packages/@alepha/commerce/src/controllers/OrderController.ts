import { $inject, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError } from "alepha/server";

import { orderItems } from "../entities/orderItems.ts";
import { orders } from "../entities/orders.ts";
import { OrderService } from "../services/OrderService.ts";

/**
 * A customer's own orders.
 *
 * Every route is scoped to the signed-in user and re-checks ownership on the
 * detail route. Scoping the list is not enough on its own: the detail route takes
 * an id, and a uuid is not a secret — without the check, any signed-in customer
 * could read anyone's order by guessing one.
 */
export class OrderController {
  protected readonly url = "/commerce/orders";
  protected readonly group = "commerce:orders";
  protected readonly orders = $inject(OrderService);

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
      response: db.page(orders.schema),
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
        order: orders.schema,
        items: z.array(orderItems.schema),
      }),
    },
    handler: async ({ params, user }) => {
      const order = await this.orders.getById(params.id);
      if (order.userId !== user.id) {
        // Deliberately not "not found": the caller is authenticated and this is
        // a real order, it is simply not theirs.
        throw new ForbiddenError("This order does not belong to you.");
      }
      return { order, items: await this.orders.itemsOf(order.id) };
    },
  });
}
