import { $inject, z } from "alepha";
import { db } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { refundLineSchema } from "../../entities/orderRefunds.ts";
import { orderReturns } from "../../entities/orderReturns.ts";
import { InvalidReturnError } from "../../errors/CommerceError.ts";
import { orderReturnStatusSchema } from "../../schemas/orderReturnStatusSchema.ts";
import { ReturnService } from "../../services/ReturnService.ts";
import { OrderRefundService } from "../services/OrderRefundService.ts";

/**
 * Returns as the workshop handles them: what is expected, what arrived, what
 * is owed.
 */
export class AdminReturnController {
  protected readonly url = "/admin/commerce/returns";
  protected readonly group = "admin:commerce:returns";
  protected readonly returns = $inject(ReturnService);
  protected readonly refunds = $inject(OrderRefundService);

  public readonly commerceAdminReturnList = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:read"] })],
    description: "List returns, newest first",
    schema: {
      query: z.object({
        size: z.integer().min(1).max(100).optional(),
        page: z.integer().min(0).optional(),
        status: orderReturnStatusSchema.optional(),
      }),
      response: db.page(orderReturns.schema),
    },
    handler: async ({ query }) => this.returns.list(query),
  });

  /**
   * The shop opening a return itself, for a customer on the phone. Goes through
   * the same rule as the customer's own request.
   */
  public readonly commerceAdminReturnCreate = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Open a return on an order",
    schema: {
      body: z.object({
        orderId: z.uuid(),
        lines: z.array(refundLineSchema).min(1),
        reason: z.text({ maxLength: 500 }).optional(),
      }),
      response: orderReturns.schema,
    },
    handler: async ({ body }) => this.returns.request(body.orderId, body),
  });

  public readonly commerceAdminReturnReceive = $action({
    method: "POST",
    path: `${this.url}/:id/receive`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Record the parcel and restock what can be sold again",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        /**
         * What can be sold again. Omitted: everything that came back.
         */
        restock: z.array(refundLineSchema).optional(),
      }),
      response: orderReturns.schema,
    },
    handler: async ({ params, body }) => this.returns.receive(params.id, body),
  });

  public readonly commerceAdminReturnRefuse = $action({
    method: "POST",
    path: `${this.url}/:id/refuse`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:write"] })],
    description: "Refuse a return",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ note: z.text({ maxLength: 500 }).optional() }),
      response: orderReturns.schema,
    },
    handler: async ({ params, body }) =>
      this.returns.refuse(params.id, body.note),
  });

  /**
   * Refund a return that came back. The units it names, at what they cost; or,
   * when it takes the whole order, everything left, because a withdrawal from
   * the whole order brings the delivery back too.
   */
  public readonly commerceAdminReturnRefund = $action({
    method: "POST",
    path: `${this.url}/:id/refund`,
    group: this.group,
    use: [$secure({ permissions: ["admin:commerce:refund"] })],
    description: "Refund a received return through the payment rail",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ reason: z.text({ maxLength: 500 }).optional() }),
      response: orderReturns.schema,
    },
    handler: async ({ params, body }) => {
      const returned = await this.returns.getById(params.id);
      if (returned.status !== "received") {
        throw new InvalidReturnError(
          `Return ${returned.id} is '${returned.status}', not 'received'.`,
        );
      }

      const whole = await this.returns.coversOrder(returned);
      const { refund } = await this.refunds.refund(returned.orderId, {
        ...(whole ? {} : { lines: returned.lines }),
        reason: body.reason ?? returned.reason,
      });
      return this.returns.markRefunded(returned.id, refund.id);
    },
  });
}
