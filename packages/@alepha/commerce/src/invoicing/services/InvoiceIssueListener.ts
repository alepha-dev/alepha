import { $hook, $inject } from "alepha";
import { $logger } from "alepha/logger";
import { InvoiceService } from "./InvoiceService.ts";

/**
 * Issues the invoice when an order is paid, and a credit note when it is
 * refunded.
 *
 * Hooked onto the domain's own events rather than called from the checkout, so
 * that a counter sale and an online order are invoiced by the same path. Adding
 * this module is the entire integration.
 *
 * A failure here must not undo the sale: the money is in, and an invoice that
 * failed to render is a problem to retry, not a reason to unwind a payment. So
 * the error is logged and swallowed — deliberately, and this is the one place in
 * the package where that is the right call.
 */
export class InvoiceIssueListener {
  protected readonly log = $logger();
  protected readonly invoices = $inject(InvoiceService);

  protected readonly onOrderPaid = $hook({
    on: "commerce:order:paid",
    handler: async (event) => {
      try {
        const invoice = await this.invoices.issueForOrder(event.orderId);
        this.log.info(`Issued invoice ${invoice.number}`, {
          orderId: event.orderId,
        });
      } catch (error) {
        this.log.error("Failed to issue an invoice for a paid order", {
          orderId: event.orderId,
          error,
        });
      }
    },
  });

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
