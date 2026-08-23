import { $inject, $store, Alepha, z } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { $workflow } from "alepha/api/workflows";

import { CheckoutService } from "../../checkout/services/CheckoutService.ts";
import { InvoiceService } from "../../invoicing/services/InvoiceService.ts";
import { OrderMailer } from "../../notifications/services/OrderMailer.ts";
import { settlementConfig } from "../settlementConfigAtom.ts";

/**
 * The durable settlement pipeline: what must happen after money is
 * captured, as a `$workflow` instead of fire-and-forget listeners.
 *
 * Two steps, each behind a `when()` guard on its module being loaded —
 * a shop that imports neither invoicing nor notifications still gets a
 * (trivially complete) settlement record per order:
 *
 * 1. `issueInvoice` — idempotent (`issueForOrder` returns the existing
 *    invoice on a retry that already succeeded before crashing).
 * 2. `sendConfirmation` — at-least-once: a crash between the SMTP accept
 *    and the step's completion write can resend. The invoice, being the
 *    legal document, is the step that must never double-issue; a rare
 *    duplicate email is the acceptable side of that trade.
 *
 * `onError: "fail"` and no `compensate` anywhere, deliberately: the money
 * is in, so nothing here may unwind the sale. A step that exhausts its
 * retries leaves a `failed` execution visible in the admin /workflows
 * page, where it can be retried — the exact opposite of the swallowed
 * `catch {}` blocks this replaces.
 */
export class SettlementWorkflows {
  protected readonly alepha = $inject(Alepha);
  protected readonly config = $store(settlementConfig);
  protected readonly checkout = $inject(CheckoutService);
  protected readonly payments = $inject(PaymentService);

  public readonly orderSettlement = $workflow({
    schema: z.object({ orderId: z.uuid() }),
    tags: ["commerce"],
    onError: "fail",
    steps: [
      {
        name: "issueInvoice",
        when: () => this.alepha.has(InvoiceService),
        retry: {
          retries: 4,
          backoff: {
            initial: [1, "second"],
            factor: 4,
            max: [10, "minute"],
            jitter: true,
          },
        },
        handler: async ({ payload }) => {
          const invoice = await this.alepha
            .inject(InvoiceService)
            .issueForOrder(payload.orderId);
          return { invoiceNumber: invoice.number };
        },
      },
      {
        name: "sendConfirmation",
        when: () => this.alepha.has(OrderMailer),
        retry: {
          retries: 4,
          backoff: {
            initial: [1, "second"],
            factor: 4,
            max: [10, "minute"],
            jitter: true,
          },
        },
        handler: async ({ payload }) => {
          const sent = await this.alepha
            .inject(OrderMailer)
            .sendConfirmationFor(payload.orderId);
          return { sent };
        },
      },
    ],
  });

  /**
   * The stranded-checkout rescue: a buyer handed to the PSP may never
   * come back, and without webhooks (or with a lost one) the session
   * would sit in `paying` forever while the money may actually have
   * moved. One durable delayed step per handoff:
   *
   * - still `paying` after the wait → ask the PSP for the truth
   *   (`PaymentService.syncIntent`, which routes any missed transition
   *   through the same guarded path a webhook takes: a captured payment
   *   settles, a failed one abandons),
   * - the PSP unreachable or non-committal → abandon; the payment
   *   module's own 30-minute expiry sweep follows as the fleet-wide net.
   *
   * The step skips when the session resolved in the meantime; a paid
   * conversion also cancels the execution via `SettlementListener`.
   */
  public readonly checkoutReconciliation = $workflow({
    schema: z.object({
      sessionId: z.uuid(),
      intentId: z.uuid(),
    }),
    tags: ["commerce", "reconciliation"],
    onError: "fail",
    steps: [
      {
        name: "reconcile",
        delay: [this.config.reconcileAfterMinutes, "minute"],
        when: async ({ payload }) => {
          const session = await this.checkout.getById(payload.sessionId);
          return session.status === "paying";
        },
        retry: {
          retries: 3,
          backoff: { initial: [1, "minute"], factor: 4 },
        },
        handler: async ({ payload }) => {
          await this.payments.syncIntent(payload.intentId);

          // syncIntent may have settled or failed the checkout through
          // the regular event listeners — re-read before deciding.
          const session = await this.checkout.getById(payload.sessionId);
          if (session.status === "completed") {
            return { outcome: "recovered-paid" };
          }
          if (session.status !== "paying") {
            return { outcome: "already-resolved" };
          }

          await this.checkout.abandonWithOrder(payload.sessionId);
          return { outcome: "abandoned" };
        },
      },
    ],
  });
}
