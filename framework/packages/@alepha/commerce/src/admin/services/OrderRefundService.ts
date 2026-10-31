import { $inject } from "alepha";
import { PaymentService } from "alepha/api/payments";

import type {
  OrderRefundEntity,
  RefundLine,
} from "../../entities/orderRefunds.ts";
import type { OrderEntity } from "../../entities/orders.ts";
import { OrderService } from "../../services/OrderService.ts";

/**
 * A refund the back office starts: written down, asked of the payment rail,
 * recorded. Here rather than in the core because the core does not know the
 * rail, and shared because three screens refund.
 */
export class OrderRefundService {
  protected readonly orders = $inject(OrderService);
  protected readonly payments = $inject(PaymentService);

  /**
   * Refund some lines, an amount, or everything left.
   *
   * The rail first. If it refuses, the order stays as it was: the customer's
   * money and our record disagreeing is the one outcome to avoid.
   */
  public async refund(
    orderId: string,
    input: { amount?: number; lines?: RefundLine[]; reason?: string } = {},
  ): Promise<{ order: OrderEntity; refund: OrderRefundEntity }> {
    const order = await this.orders.getById(orderId);
    const refund = await this.orders.prepareRefund(orderId, input);

    if (order.paymentIntentId) {
      try {
        await this.payments.refund(
          order.paymentIntentId,
          refund.amount,
          input.reason,
        );
      } catch (error) {
        await this.orders.dropRefund(refund.id);
        throw error;
      }
    }

    return {
      order: await this.orders.refund(orderId, {
        refundedTotal: order.refundedTotal + refund.amount,
        reason: input.reason,
      }),
      refund,
    };
  }
}
