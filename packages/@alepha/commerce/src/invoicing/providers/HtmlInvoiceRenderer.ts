import type { VatBucket } from "../../services/VatCalculator.ts";
import type { InvoiceEntity, InvoiceLine } from "../entities/invoices.ts";
import type { SellerIdentity } from "../sellerIdentityAtom.ts";
import { InvoiceRenderer, type RenderedInvoice } from "./InvoiceRenderer.ts";

/**
 * Renders a print-ready, legally complete invoice as HTML.
 *
 * Every element below is there because a French B2C invoice is invalid without
 * it: the seller's registered name, address and company number; the invoice's
 * own number and date; the buyer's name and address; per-line quantity and unit
 * price; the tax broken down per rate; and, when the seller is not liable for
 * VAT, the statutory notice printed *instead of* the tax lines.
 *
 * The layout is plain on purpose — an invoice is read by a customer once and by
 * an accountant twice, and neither wants a design.
 */
export class HtmlInvoiceRenderer extends InvoiceRenderer {
  public async render(invoice: InvoiceEntity): Promise<RenderedInvoice> {
    const seller = invoice.seller as unknown as SellerIdentity;
    const buyer = invoice.buyer as unknown as Record<string, string>;
    const lines = invoice.lines as unknown as InvoiceLine[];
    const buckets = invoice.vatBuckets as unknown as VatBucket[];
    const credit = Boolean(invoice.creditsInvoiceId);

    return {
      contentType: "text/html; charset=utf-8",
      filename: `${invoice.number}.html`,
      body: `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${this.escape(invoice.number)}</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
  header { display: flex; justify-content: space-between; gap: 2rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  address { font-style: normal; }
  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #ddd; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 600; border-bottom: none; }
  .notice { padding: .6rem .8rem; background: #f4f4f5; border-left: 3px solid #999; }
  footer { margin-top: 2rem; color: #555; font-size: 12px; }
  @media print { body { margin: 0; } }
</style></head>
<body>
<header>
  <div>
    <h1>${credit ? "Facture d'avoir" : "Facture"} ${this.escape(invoice.number)}</h1>
    <div>Émise le ${this.formatDate(invoice.issuedAt)}</div>
    ${
      credit
        ? `<div>Annule et remplace la facture précédente${
            invoice.note ? ` — ${this.escape(invoice.note)}` : ""
          }</div>`
        : ""
    }
  </div>
  <address>
    <strong>${this.escape(seller.name)}</strong><br>
    ${this.escape(seller.address).replace(/\n/g, "<br>")}<br>
    ${seller.legalForm ? `${this.escape(seller.legalForm)}<br>` : ""}
    SIRET ${this.escape(seller.registrationNumber)}<br>
    ${seller.vatNumber ? `TVA ${this.escape(seller.vatNumber)}<br>` : ""}
    ${seller.email ? `${this.escape(seller.email)}<br>` : ""}
  </address>
</header>

<h2>Client</h2>
<address>
  ${this.escape(buyer.fullName ?? "")}<br>
  ${buyer.line1 ? `${this.escape(buyer.line1)}<br>` : ""}
  ${buyer.line2 ? `${this.escape(buyer.line2)}<br>` : ""}
  ${this.escape(buyer.postalCode ?? "")} ${this.escape(buyer.locality ?? "")}<br>
  ${this.escape(buyer.country ?? "")}
</address>

<table>
  <thead><tr>
    <th>Désignation</th>
    <th class="num">Qté</th>
    <th class="num">P.U. TTC</th>
    ${seller.vatExemptionNotice ? "" : '<th class="num">TVA</th>'}
    <th class="num">Total TTC</th>
  </tr></thead>
  <tbody>
    ${lines
      .map(
        (line) => `<tr>
      <td>${this.escape(line.description)}</td>
      <td class="num">${line.quantity}</td>
      <td class="num">${this.money(line.unitPrice, invoice.currency)}</td>
      ${
        seller.vatExemptionNotice
          ? ""
          : `<td class="num">${this.rate(line.rateBps)}</td>`
      }
      <td class="num">${this.money(line.lineTotal, invoice.currency)}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
  <tfoot>
    ${
      seller.vatExemptionNotice
        ? `<tr><td colspan="3">Total</td><td class="num">${this.money(
            invoice.grandTotal,
            invoice.currency,
          )}</td></tr>`
        : `<tr><td colspan="3">Total HT</td><td class="num"></td><td class="num">${this.money(
            invoice.baseTotal,
            invoice.currency,
          )}</td></tr>
      ${buckets
        .map(
          (bucket) => `<tr>
        <td colspan="3">TVA ${this.rate(bucket.rateBps)} sur ${this.money(
          bucket.baseCents,
          invoice.currency,
        )}</td><td class="num"></td>
        <td class="num">${this.money(bucket.vatCents, invoice.currency)}</td>
      </tr>`,
        )
        .join("")}
      <tr><td colspan="3">Total TTC</td><td class="num"></td><td class="num">${this.money(
        invoice.grandTotal,
        invoice.currency,
      )}</td></tr>`
    }
  </tfoot>
</table>

${
  seller.vatExemptionNotice
    ? `<p class="notice">${this.escape(seller.vatExemptionNotice)}</p>`
    : ""
}

<footer>
  <p>Facture acquittée. Le paiement a été reçu à la commande.</p>
  <p>
    Conformément aux articles L221-18 et suivants du code de la consommation,
    vous disposez d'un délai de quatorze jours à compter de la réception pour
    exercer votre droit de rétractation.
  </p>
</footer>
</body></html>`,
    };
  }

  protected money(cents: number, currency: string): string {
    const sign = cents < 0 ? "−" : "";
    return `${sign}${(Math.abs(cents) / 100).toFixed(2)} ${currency}`;
  }

  /**
   * Basis points to a percentage: 2000 → "20 %", 550 → "5,5 %".
   */
  protected rate(bps: number): string {
    const percent = bps / 100;
    return `${String(percent).replace(".", ",")} %`;
  }

  protected formatDate(iso: string): string {
    const [year, month, day] = iso.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }

  protected escape(value: string): string {
    return value.replace(/[&<>"']/g, (c) =>
      c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === ">"
            ? "&gt;"
            : c === '"'
              ? "&quot;"
              : "&#39;",
    );
  }
}
