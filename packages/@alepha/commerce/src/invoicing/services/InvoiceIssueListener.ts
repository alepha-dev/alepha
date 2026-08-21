import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";

import { InvoiceService } from "./InvoiceService.ts";

/**
 * Issues the credit note when an order is refunded.
 *
 * The paid-side invoice is NOT issued here anymore: it is the first step
 * of the settlement workflow (`@alepha/commerce/settlement`), with
 * per-step retry and a visible execution — the swallowed-error hook that
 * used to live here could silently lose a legally required document.
 * Import the settlement module to issue invoices on payment at all.
 *
 * A failure here must not undo the refund, so the credit-note error is
 * still logged and swallowed; moving it onto the same durable footing is
 * the refund-saga follow-up.
 */
export class InvoiceIssueListener {
  protected readonly log = $logger();
  protected readonly invoices = $inject(InvoiceService);

  protected readonly onOrderRefunded = $hook({
    on: "commerce:order:refunded",
    handler: async (event) => {
      try {
        const issued = await this.invoices.listForOrder(event.orderId);
        const original = issued.find((i) => !i.creditsInvoiceId);
        if (!original) {
          this.log.warn("Refunded an order that was never invoiced", {
            orderId: event.orderId,
          });
          return;
        }
        if (issued.some((i) => i.creditsInvoiceId === original.id)) {
          // Already credited — a redelivered refund event.
          return;
        }
        const note = await this.invoices.creditNote(original.id, {
          reason: "Remboursement de la commande",
        });
        this.log.info(`Issued credit note ${note.number}`, {
          orderId: event.orderId,
        });
      } catch (error) {
        this.log.error("Failed to issue a credit note", {
          orderId: event.orderId,
          error,
        });
      }
    },
  });
}
