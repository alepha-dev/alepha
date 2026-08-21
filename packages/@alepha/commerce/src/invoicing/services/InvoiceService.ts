import { $inject, $store } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, DatabaseProvider } from "alepha/orm";

import { TaxService } from "../../checkout/services/TaxService.ts";
import { CommerceError } from "../../errors/CommerceError.ts";
import { OrderService } from "../../services/OrderService.ts";
import { type VatBucket, VatCalculator } from "../../services/VatCalculator.ts";
import {
  type InvoiceEntity,
  type InvoiceLine,
  invoices,
} from "../entities/invoices.ts";
import { sellerIdentityAtom } from "../sellerIdentityAtom.ts";

/**
 * Issues invoices and credit notes.
 *
 * The two properties that make an invoice legal rather than decorative:
 *
 * 1. **The number is gapless.** `$sequence` participates in the surrounding
 *    transaction, so a rollback returns the number to the pool instead of
 *    burning it. Postgres's own `nextval()` deliberately does the opposite,
 *    which would leave holes — and a hole in an invoice series is what an audit
 *    asks about.
 * 2. **The content is frozen.** Everything is copied onto the row at issue time,
 *    so no later edit to a product or an address can rewrite what was billed.
 *
 * Correcting an invoice is therefore issuing a credit note, never editing.
 */
export class InvoiceService {
  protected readonly db = $inject(DatabaseProvider);
  protected readonly repo = $repository(invoices);
  protected readonly orders = $inject(OrderService);
  protected readonly vat = $inject(VatCalculator);
  protected readonly tax = $inject(TaxService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly seller = $store(sellerIdentityAtom);

  /**
   * One counter per organisation and year, so numbering restarts each January
   * without ever colliding — the usual French practice.
   */
  protected readonly invoiceNumber = $sequence({ name: "commerce_invoice" });

  /**
   * Issue the invoice for a paid order, or return the one already issued.
   *
   * Idempotent by design: settlement can be re-driven by a redelivered webhook,
   * and issuing two invoices for one sale is a far worse outcome than doing
   * nothing.
   *
   * @throws CommerceError when the order is not paid
   */
  public async issueForOrder(orderId: string): Promise<InvoiceEntity> {
    const existing = await this.repo.findOne({
      where: { orderId: { eq: orderId }, creditsInvoiceId: { isNull: true } },
    });
    if (existing) {
      return existing;
    }

    const order = await this.orders.getById(orderId);
    if (order.status === "pending" || order.status === "cancelled") {
      throw new CommerceError(
        `Cannot invoice order ${orderId}: it is '${order.status}'.`,
      );
    }

    const items = await this.orders.itemsOf(orderId);
    const seller = this.seller;
    const exempt = Boolean(seller.vatExemptionNotice);
    // Each line bills at the rate snapshotted onto it, falling back to the
    // seller's default. A mixed-rate order — books beside goods — is the normal
    // case, not an edge one, and applying one rate to all of it produced an
    // invoice whose single bucket disagreed with what was sold.
    const rateOf = (snapshot?: number) =>
      exempt ? 0 : (snapshot ?? this.tax.rateBps());

    const lines: InvoiceLine[] = items.map((item) => ({
      description: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.unitPrice * item.quantity,
      rateBps: rateOf(item.rateBps),
    }));

    // Delivery is a billable line of its own. It takes the seller's default
    // rate rather than any one product's: with a mixed-rate basket there is no
    // single "rate of the goods" to inherit, and apportioning delivery across
    // the rates present is a further step this does not take.
    if (order.shippingTotal > 0) {
      lines.push({
        description: `Livraison${order.shippingMethod ? ` (${order.shippingMethod})` : ""}`,
        quantity: 1,
        unitPrice: order.shippingTotal,
        lineTotal: order.shippingTotal,
        rateBps: rateOf(undefined),
      });
    }

    const buckets = this.vat.ventilate(
      lines.map((line) => ({
        ttcCents: line.lineTotal,
        rateBps: line.rateBps,
      })),
    );
    const totals = this.vat.totals(buckets);

    if (totals.ttcCents !== order.total) {
      throw new CommerceError(
        `Invoice total ${totals.ttcCents} does not match order total ${order.total} for order ${orderId}.`,
      );
    }

    // The number and the row are written in one transaction, so a failure here
    // cannot consume a number.
    return this.db.transactional(async () => {
      const year = Number(this.dateTime.nowISOString().slice(0, 4));
      const seq = await this.invoiceNumber.next(String(year));

      return this.repo.create({
        number: this.formatNumber(seller.numberPrefix, year, seq),
        year,
        orderId,
        issuedAt: this.dateTime.nowISOString(),
        seller,
        buyer: (order.shippingAddress as Record<string, any>) ?? {
          fullName: "Client",
        },
        lines,
        vatBuckets: buckets,
        baseTotal: totals.baseCents,
        vatTotal: totals.vatCents,
        grandTotal: totals.ttcCents,
        currency: order.currency,
      });
    });
  }

  /**
   * Issue a credit note reversing an invoice, in full or in part.
   *
   * A credit note takes the *next* number in the same series — it is not a
   * deletion and it does not reuse the corrected invoice's number.
   */
  public async creditNote(
    invoiceId: string,
    options: { reason?: string } = {},
  ): Promise<InvoiceEntity> {
    const original = await this.repo.getById(invoiceId);

    const lines = (original.lines as unknown as InvoiceLine[]).map((line) => ({
      ...line,
      quantity: -line.quantity,
      lineTotal: -line.lineTotal,
    }));
    const buckets = (original.vatBuckets as unknown as VatBucket[]).map(
      (bucket) => ({
        rateBps: bucket.rateBps,
        baseCents: -bucket.baseCents,
        vatCents: -bucket.vatCents,
      }),
    );

    return this.db.transactional(async () => {
      const year = Number(this.dateTime.nowISOString().slice(0, 4));
      const seq = await this.invoiceNumber.next(String(year));
      const seller = this.seller;

      return this.repo.create({
        number: this.formatNumber(seller.numberPrefix, year, seq),
        year,
        orderId: original.orderId,
        creditsInvoiceId: original.id,
        issuedAt: this.dateTime.nowISOString(),
        seller: original.seller,
        buyer: original.buyer,
        lines,
        vatBuckets: buckets,
        baseTotal: -original.baseTotal,
        vatTotal: -original.vatTotal,
        grandTotal: -original.grandTotal,
        currency: original.currency,
        note: options.reason,
      });
    });
  }

  public async getById(id: string): Promise<InvoiceEntity> {
    return this.repo.getById(id);
  }

  public async findByNumber(
    number: string,
  ): Promise<InvoiceEntity | undefined> {
    return this.repo.findOne({ where: { number: { eq: number } } });
  }

  public async listForOrder(orderId: string): Promise<InvoiceEntity[]> {
    return this.repo.findMany({
      where: { orderId: { eq: orderId } },
      orderBy: "createdAt",
    });
  }

  /**
   * `FA-2026-000001`. Zero-padded so a plain text sort matches issue order,
   * which is what anyone reading a folder of invoices expects.
   */
  protected formatNumber(
    prefix: string,
    year: number,
    sequence: number,
  ): string {
    return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
  }
}
