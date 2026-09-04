import { $hook, $inject, $store } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { settlementConfig } from "../settlementConfigAtom.ts";
import { SettlementJobs } from "./SettlementJobs.ts";

/**
 * Pushes the settlement job when an order is paid, schedules a
 * reconciliation when a checkout is handed to the payment rail, and stands
 * the reconciliation down once the order pays.
 *
 * `commerce:order:paid` fires once per order, after the outermost
 * transaction commits (see OrderService.markPaid), so the push here reads a
 * committed order. The `key`s make both pushes idempotent anyway: a
 * duplicate event while an execution is live resolves to the same one.
 */
export class SettlementListener {
  protected readonly log = $logger();
  protected readonly jobs = $inject(SettlementJobs);
  protected readonly config = $store(settlementConfig);
  protected readonly sessions = $repository(checkoutSessions);

  protected readonly onCheckoutPaying = $hook({
    on: "commerce:checkout:paying",
    handler: async (event) => {
      const executionId = await this.jobs.checkoutReconciliation.push(
        { sessionId: event.sessionId, intentId: event.intentId },
        {
          key: event.sessionId,
          delay: [this.config.reconcileAfterMinutes, "minute"],
        },
      );
      this.log.debug("Checkout reconciliation scheduled", {
        sessionId: event.sessionId,
        executionId,
      });
    },
  });

  protected readonly onOrderPaid = $hook({
    on: "commerce:order:paid",
    handler: async (event) => {
      const executionId = await this.jobs.orderSettlement.push(
        { orderId: event.orderId },
        { key: event.orderId },
      );
      this.log.debug("Settlement job pushed", {
        orderId: event.orderId,
        executionId,
      });

      await this.cancelReconciliationFor(event.orderId);
    },
  });

  /**
   * A paid order means the reconciliation has nothing left to do; its own
   * opening re-check would skip anyway. Cancelling the parked row now ends
   * it and says why in the admin.
   *
   * When the reconciliation is the RUNNING actor, this very event is its
   * own doing (the poll found the capture and settled). `cancelByKey`
   * leaves a running row alone by contract, so the execution that rescued
   * the money completes as `ok` rather than being branded `cancelled`.
   */
  protected async cancelReconciliationFor(orderId: string): Promise<void> {
    const session = await this.sessions.findOne({
      where: { orderId: { eq: orderId } },
    });
    if (!session) {
      return;
    }

    const cancelled = await this.jobs.checkoutReconciliation.cancelByKey(
      session.id,
      { cancelledBy: "system", cancelledByName: "checkout settled" },
    );
    if (cancelled) {
      this.log.debug("Checkout reconciliation cancelled, order paid", {
        sessionId: session.id,
        executionId: cancelled,
      });
    }
  }
}
