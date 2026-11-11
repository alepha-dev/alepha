import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { orderItems } from "../../entities/orderItems.ts";
import { orderRefunds } from "../../entities/orderRefunds.ts";
import { orderReturns } from "../../entities/orderReturns.ts";
import { type OrderEntity, orders } from "../../entities/orders.ts";
import type { OrderCancelledWebhook } from "../schemas/orderCancelledWebhookSchema.ts";
import type { OrderPaidWebhook } from "../schemas/orderPaidWebhookSchema.ts";
import type { OrderRefundedWebhook } from "../schemas/orderRefundedWebhookSchema.ts";
import type { OrderShippedWebhook } from "../schemas/orderShippedWebhookSchema.ts";
import type { ReturnRequestedWebhook } from "../schemas/returnRequestedWebhookSchema.ts";
import type { WebhookOrderLine } from "../schemas/webhookOrderLineSchema.ts";
import type { WebhookShippingAddress } from "../schemas/webhookShippingAddressSchema.ts";

/**
 * Builds each commerce webhook's payload from the committed order, key by
 * key.
 *
 * **Exclusion is the default.** Nothing is spread or forwarded: a column
 * added to the order later cannot ride along into a payload, because no
 * payload names it. Never: a payment instrument, the customer's email, a
 * phone number, billing details, the VAT number, the user id, the order's
 * free-text notes, or a free-text reason.
 */
export class CommerceWebhookPayloads {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly orders = $repository(orders);
  protected readonly items = $repository(orderItems);
  protected readonly refunds = $repository(orderRefunds);
  protected readonly returns = $repository(orderReturns);

  public async paid(orderId: string): Promise<OrderPaidWebhook> {
    const order = await this.orders.getById(orderId);
    return {
      orderId: order.id,
      ...(order.number ? { number: order.number } : {}),
      status: order.status,
      currency: order.currency,
      total: order.total,
      discountTotal: order.discountTotal,
      shippingTotal: order.shippingTotal,
      taxTotal: order.taxTotal,
      items: await this.lines(order.id),
      ...(order.shippingMethod ? { shippingMethod: order.shippingMethod } : {}),
      ...this.address(order),
      createdAt: order.createdAt,
      paidAt: this.dateTime.nowISOString(),
    };
  }

  public async shipped(orderId: string): Promise<OrderShippedWebhook> {
    const order = await this.orders.getById(orderId);
    return {
      orderId: order.id,
      ...(order.number ? { number: order.number } : {}),
      status: order.status,
      items: await this.lines(order.id),
      ...(order.shippingMethod ? { shippingMethod: order.shippingMethod } : {}),
      ...(order.trackingNumber ? { trackingNumber: order.trackingNumber } : {}),
      ...(order.trackingUrl ? { trackingUrl: order.trackingUrl } : {}),
      ...this.address(order),
      shippedAt: this.toIso(order.shippedAt),
    };
  }

  public async refunded(refundId: string): Promise<OrderRefundedWebhook> {
    const refund = await this.refunds.getById(refundId);
    const order = await this.orders.getById(refund.orderId);
    return {
      orderId: order.id,
      ...(order.number ? { number: order.number } : {}),
      refundId: refund.id,
      status: order.status,
      currency: order.currency,
      total: order.total,
      amount: refund.amount,
      refundedTotal: order.refundedTotal,
      refundedAt: refund.createdAt,
    };
  }

  public async cancelled(orderId: string): Promise<OrderCancelledWebhook> {
    const order = await this.orders.getById(orderId);
    return {
      orderId: order.id,
      ...(order.number ? { number: order.number } : {}),
      status: order.status,
      currency: order.currency,
      total: order.total,
      cancelledAt: this.dateTime.nowISOString(),
    };
  }

  public async returnRequested(
    returnId: string,
  ): Promise<ReturnRequestedWebhook> {
    const row = await this.returns.getById(returnId);
    const order = await this.orders.getById(row.orderId);
    return {
      returnId: row.id,
      orderId: order.id,
      ...(order.number ? { number: order.number } : {}),
      lines: row.lines.map((it) => ({
        orderItemId: it.orderItemId,
        quantity: it.quantity,
      })),
      requestedAt: row.createdAt,
    };
  }

  protected async lines(orderId: string): Promise<WebhookOrderLine[]> {
    const rows = await this.items.findMany({
      where: { orderId: { eq: orderId } },
    });
    return rows.map((it) => ({
      ...(it.sku ? { sku: it.sku } : {}),
      name: it.name,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    }));
  }

  /**
   * The recipient's name and postal address, PICKED key by key from the
   * opaque `shippingAddress` column. Absent when the order has none, or when
   * what is stored lacks a required key (an order made outside the
   * checkout): a webhook is never refused over it.
   */
  protected address(order: OrderEntity): {
    shippingAddress?: WebhookShippingAddress;
  } {
    const stored = order.shippingAddress as Record<string, unknown> | undefined;
    if (!stored || typeof stored !== "object") return {};
    const text = (key: string) =>
      typeof stored[key] === "string" && stored[key] !== ""
        ? (stored[key] as string)
        : undefined;
    const fullName = text("fullName");
    const line1 = text("line1");
    const locality = text("locality");
    const postalCode = text("postalCode");
    const country = text("country");
    if (!fullName || !line1 || !locality || !postalCode || !country) return {};
    const line2 = text("line2");
    const region = text("region");
    return {
      shippingAddress: {
        fullName,
        line1,
        ...(line2 ? { line2 } : {}),
        locality,
        ...(region ? { region } : {}),
        postalCode,
        country,
      },
    };
  }

  protected toIso(value: string | undefined): string {
    return value
      ? this.dateTime.of(value).toISOString()
      : this.dateTime.nowISOString();
  }
}
