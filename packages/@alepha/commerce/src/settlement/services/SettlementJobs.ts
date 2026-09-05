import { $inject, Alepha, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { PaymentService } from "alepha/api/payments";

import { CheckoutService } from "../../checkout/services/CheckoutService.ts";
import { InvoiceService } from "../../invoicing/services/InvoiceService.ts";
import { OrderMailer } from "../../notifications/services/OrderMailer.ts";

/**
 * The durable settlement pipeline: what must happen after money is
 * captured, as `$job`s instead of fire-and-forget listeners.
 *
 * `orderSettlement` runs two stages in one handler, each behind an
 * `alepha.has()` guard on its module being loaded, so a shop that imports
 * neither invoicing nor notifications still gets a (trivially complete)
 * settlement record per order:
 *
 * 1. `issueInvoice`: idempotent (`issueForOrder` returns the existing
 *    invoice on a retry that already succeeded before crashing).
 * 2. `sendConfirmation`: at-least-once. A crash between the SMTP accept and
 *    the row's completion can resend. The invoice, being the legal
 *    document, is the stage that must never double-issue; a rare duplicate
 *    email is the acceptable side of that trade.
 *
 * The two run back to back rather than as a `reschedule`: there is no wait
 * between them, and a retry after a crash in the second re-runs a no-op
 * first stage. Nothing here unwinds the sale, deliberately: the money is
 * in. A job that exhausts its retries leaves an `error` row on the admin
 * jobs page, where it can be retried, the exact opposite of the swallowed
 * `catch {}` blocks this replaces.
 */
export class SettlementJobs {
  protected readonly alepha = $inject(Alepha);
  protected readonly checkout = $inject(CheckoutService);
  protected readonly payments = $inject(PaymentService);

  public readonly orderSettlement = $job({
    description:
      "Issues the invoice and sends the confirmation once an order is paid.",
    schema: z.object({ orderId: z.uuid() }),
    record: "all",
    retry: {
      retries: 4,
      backoff: { initial: [1, "second"], factor: 4, max: [10, "minute"] },
    },
    handler: async ({ payload }) => {
      if (this.alepha.has(InvoiceService)) {
        await this.alepha.inject(InvoiceService).issueForOrder(payload.orderId);
      }
      if (this.alepha.has(OrderMailer)) {
        await this.alepha
          .inject(OrderMailer)
          .sendConfirmationFor(payload.orderId);
      }
    },
  });

  /**
   * The stranded-checkout rescue: a buyer handed to the PSP may never come
   * back, and without webhooks (or with a lost one) the session would sit
   * in `paying` forever while the money may actually have moved. One
   * delayed execution per handoff, pushed by `SettlementListener` with the
   * configured wait:
   *
   * - still `paying` after the wait: ask the PSP for the truth
   *   (`PaymentService.syncIntent`, which routes any missed transition
   *   through the same guarded path a webhook takes: a captured payment
   *   settles, a failed one abandons),
   * - the PSP unreachable or non-committal: abandon; the payment module's
   *   own 30-minute expiry sweep follows as the fleet-wide net.
   *
   * The handler returns at once when the session resolved in the meantime;
   * a paid conversion also cancels the parked row via `SettlementListener`.
   */
  public readonly checkoutReconciliation = $job({
    description:
      "Polls the PSP for a checkout still paying after the wait, then settles or abandons it.",
    schema: z.object({
      sessionId: z.uuid(),
      intentId: z.uuid(),
    }),
    record: "all",
    retry: {
      retries: 3,
      backoff: { initial: [1, "minute"], factor: 4 },
    },
    handler: async ({ payload }) => {
      const before = await this.checkout.getById(payload.sessionId);
      if (before.status !== "paying") {
        return;
      }

      const intentStatus = await this.payments.syncIntent(payload.intentId);

      // syncIntent may have settled or failed the checkout through the
      // regular event listeners: re-read before deciding.
      const session = await this.checkout.getById(payload.sessionId);
      if (session.status !== "paying") {
        return;
      }

      // Captured, yet the session never completed: `settle()` threw inside
      // the `captured` webhook (a transient DB error, an invoice sequence
      // hiccup) and nothing retried it, because `syncIntent` returns early
      // on a terminal intent status and so has nothing left to replay.
      // Reaching the abandon below would cancel an order the customer has
      // already paid for, which is the one outcome this job must never
      // produce.
      //
      // `settle()` is idempotent (it returns a `completed` session
      // untouched, and `OrderService.markPaid` is idempotent one level
      // down), so replaying it is safe even when the earlier attempt got
      // part of the way through.
      if (intentStatus === "captured") {
        await this.checkout.settle(payload.sessionId, {
          paymentIntentId: payload.intentId,
        });
        return;
      }

      await this.checkout.abandonWithOrder(payload.sessionId);
    },
  });
}
