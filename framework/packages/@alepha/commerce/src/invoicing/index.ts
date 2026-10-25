import { $module } from "alepha";

import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { OrderDocumentsProvider } from "../checkout/providers/OrderDocumentsProvider.ts";
import { HtmlInvoiceRenderer } from "./providers/HtmlInvoiceRenderer.ts";
import { InvoiceRenderer } from "./providers/InvoiceRenderer.ts";
import { sellerIdentityAtom } from "./sellerIdentityAtom.ts";
import { InvoiceIssueListener } from "./services/InvoiceIssueListener.ts";
import { InvoiceService } from "./services/InvoiceService.ts";

export * from "./entities/invoices.ts";
export * from "./providers/HtmlInvoiceRenderer.ts";
export * from "./providers/InvoiceRenderer.ts";
export * from "./sellerIdentityAtom.ts";
export * from "./services/InvoiceIssueListener.ts";
export * from "./services/InvoiceService.ts";

/**
 * Gapless, frozen invoices with a per-rate tax breakdown.
 *
 * Not optional in France: a B2C sale must be invoiced, the numbering must have
 * no holes, and the tax must be shown per rate. A separate module all the same,
 * because Ticketing and a POS have their own fiscal obligations and different
 * documents to produce.
 *
 * Importing it is the whole integration — an invoice is issued automatically
 * when an order is paid. Configure the seller first, or every invoice will claim
 * to come from "Unnamed seller":
 *
 * ```ts
 * alepha.store.set(sellerIdentityAtom.key, {
 *   name: "Atelier Aurore",
 *   address: "12 rue des Orfèvres, 75001 Paris",
 *   registrationNumber: "912 345 678 00012",
 *   vatNumber: "FR91234567800",
 *   numberPrefix: "FA",
 * });
 * ```
 *
 * @module alepha.commerce.invoicing
 */
export const AlephaCommerceInvoicing = $module({
  name: "alepha.commerce.invoicing",
  imports: [AlephaCommerceCheckout],
  atoms: [sellerIdentityAtom],
  services: [InvoiceService, InvoiceRenderer, InvoiceIssueListener],
  variants: [HtmlInvoiceRenderer],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: InvoiceRenderer,
      use: HtmlInvoiceRenderer,
    });
    // Contribute invoice numbers to the checkout's document list. A push rather
    // than a substitution, so the order this module is wired in cannot matter.
    const invoices = alepha.inject(InvoiceService);
    alepha.inject(OrderDocumentsProvider).add(async (orderId) => {
      const issued = await invoices.listForOrder(orderId);
      return issued.map((invoice) => invoice.number);
    });
  },
});
