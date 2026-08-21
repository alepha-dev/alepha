import { $hook, $inject } from "alepha";
import {
  WorkflowProvider,
  workflowExecutions,
  workflowStepExecutions,
} from "alepha/api/workflows";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { SettlementWorkflows } from "./SettlementWorkflows.ts";

/**
 * Starts the settlement workflow when an order is paid, schedules a
 * reconciliation when a checkout is handed to the payment rail, and
 * stands the reconciliation down once the order pays.
 *
 * `commerce:order:paid` fires once per order, after the outermost
 * transaction commits (see OrderService.markPaid), so the start here
 * reads a committed order. The `key`s make both starts idempotent
 * anyway: a duplicate event while an execution is live resolves to the
 * same execution.
 */
export class SettlementListener {
  protected readonly log = $logger();
  protected readonly workflows = $inject(SettlementWorkflows);
  protected readonly workflowProvider = $inject(WorkflowProvider);
  protected readonly executions = $repository(workflowExecutions);
  protected readonly steps = $repository(workflowStepExecutions);
  protected readonly sessions = $repository(checkoutSessions);

  protected readonly onCheckoutPaying = $hook({
    on: "commerce:checkout:paying",
    handler: async (event) => {
      const executionId = await this.workflows.checkoutReconciliation.start(
        { sessionId: event.sessionId, intentId: event.intentId },
        { key: event.sessionId },
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
      const executionId = await this.workflows.orderSettlement.start(
        { orderId: event.orderId },
        { key: event.orderId },
      );
      this.log.debug("Settlement workflow started", {
        orderId: event.orderId,
        executionId,
      });

      await this.cancelReconciliationFor(event.orderId);
    },
  });

  /**
   * A paid order means the reconciliation has nothing left to do — its
   * `when()` guard would skip anyway; cancelling now ends the execution
   * and says why in the admin.
   */
  protected async cancelReconciliationFor(orderId: string): Promise<void> {
    const session = await this.sessions.findOne({
      where: { orderId: { eq: orderId } },
    });
    if (!session) {
      return;
    }

    const live = await this.executions.findOne({
      where: {
        workflowName: {
          eq: "SettlementWorkflows.checkoutReconciliation",
        },
        key: { eq: session.id },
        status: { inArray: ["pending", "running"] },
      },
    });
    if (!live) {
      return;
    }

    // When the reconcile step is the RUNNING actor, this very event is
    // its own doing (the poll found the capture and settled) — cancelling
    // would brand the execution that rescued the money "cancelled". Let
    // it finish and record its outcome; it completes on its own.
    const reconcileStep = await this.steps.findOne({
      where: {
        workflowExecutionId: { eq: live.id },
        stepName: { eq: "reconcile" },
      },
    });
    if (reconcileStep?.status === "running") {
      return;
    }

    await this.workflowProvider.cancel(live.id, {
      cancelledBy: "system",
      cancelledByName: "checkout settled",
    });
    this.log.debug("Checkout reconciliation cancelled — order paid", {
      sessionId: session.id,
      executionId: live.id,
    });
  }
}
