import { $hook, $inject } from "alepha";
import { WorkflowProvider, workflowExecutions } from "alepha/api/workflows";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { checkoutSessions } from "../../checkout/entities/checkoutSessions.ts";
import { CartRecoveryWorkflows } from "./CartRecoveryWorkflows.ts";

/**
 * Starts the recovery sequence when a checkout captures an email, and
 * cancels it the moment the order pays.
 *
 * The start is idempotent (`key` = cart id): a buyer correcting their
 * email mid-checkout re-fires the event and lands on the same execution.
 */
export class CartRecoveryListener {
  protected readonly log = $logger();
  protected readonly workflows = $inject(CartRecoveryWorkflows);
  protected readonly workflowProvider = $inject(WorkflowProvider);
  protected readonly executions = $repository(workflowExecutions);
  protected readonly sessions = $repository(checkoutSessions);

  protected readonly onCheckoutEmail = $hook({
    on: "commerce:checkout:email",
    handler: async (event) => {
      const executionId = await this.workflows.cartRecovery.start(
        { cartId: event.cartId },
        { key: event.cartId },
      );
      this.log.debug("Cart recovery sequence started", {
        cartId: event.cartId,
        executionId,
      });
    },
  });

  protected readonly onOrderPaid = $hook({
    on: "commerce:order:paid",
    handler: async (event) => {
      const session = await this.sessions.findOne({
        where: { orderId: { eq: event.orderId } },
      });
      if (!session) {
        return;
      }

      // The when() guards would skip the remaining steps anyway; the
      // cancel just ends the execution now and says why in the admin.
      const live = await this.executions.findOne({
        where: {
          workflowName: { eq: "CartRecoveryWorkflows.cartRecovery" },
          key: { eq: session.cartId },
          status: { inArray: ["pending", "running"] },
        },
      });
      if (!live) {
        return;
      }

      await this.workflowProvider.cancel(live.id, {
        cancelledBy: "system",
        cancelledByName: "checkout converted",
      });
      this.log.debug("Cart recovery sequence cancelled — cart converted", {
        cartId: session.cartId,
        executionId: live.id,
      });
    },
  });
}
