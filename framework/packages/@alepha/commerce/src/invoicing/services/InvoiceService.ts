import { $inject, $store } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, DatabaseProvider } from "alepha/orm";

import { TaxService } from "../../checkout/services/TaxService.ts";
import type { RefundLine } from "../../entities/orderRefunds.ts";
import { CommerceError } from "../../errors/CommerceError.ts";
import { ClaimLock } from "../../services/ClaimLock.ts";
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
  protected readonly lock = $inject(ClaimLock);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly seller = $store(sellerIdentityAtom);

  /**
   * One counter per year, so numbering restarts each January without ever
   * colliding. The `default:` prefix preserves the historical sequence scope.
   */
  protected readonly invoiceNumber = $sequence({ name: "commerce_invoice" });

  /**
   * First key of the per-order issue lock. See `ClaimLock`.
   */
  public static readonly LOCK_NAMESPACE = "alepha:commerce:invoice";

  /**
   * Issue the invoice for a paid order, or return the one already issued.
   *
   * Idempotent by design: settlement can be re-driven by a redelivered webhook,
   * and issuing two invoices for one sale is a far worse outcome than doing
   * nothing.
   *
   * Under a lock on the order, because two jobs can get here at once: the
   * settlement's and, for an order refunded straight after it was paid, the
   * credit note's.
   *
   * @throws CommerceError when the order is not paid
   */
  public async issueForOrder(orderId: string): Promise<InvoiceEntity> {
    return this.lock.run(
      { namespace: InvoiceService.LOCK_NAMESPACE, key: orderId },
      () => this.issue(orderId),
    );
  }

  protected async issue(orderId: string): Promise<InvoiceEntity> {
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
      description: item.variantLabel
        ? `${item.name} (${item.variantLabel})`
        : item.name,
      sku: item.sku,
      orderItemId: item.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount > 0 ? item.discount : undefined,
      lineTotal: item.unitPrice * item.quantity - item.discount,
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
      // In the seller's timezone, not UTC — see `issuedOn`.
      const issuedAt = this.issuedOn(seller.timezone);
      const year = Number(issuedAt.slice(0, 4));
      const seq = await this.invoiceNumber.next(`default:${year}`);

      return this.repo.create({
        number: this.formatNumber(seller.numberPrefix, year, seq),
        year,
        orderId,
        issuedAt,
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
   *
   * With `lines`, it credits those units, each at its own rate. With `amount`,
   * it credits that figure exactly, shared across the rates of what the invoice
   * has left. With neither, it credits everything left, which is the whole
   * invoice when nothing was credited before. So however a refund was cut up,
   * the credit notes of a fully refunded order add up to the invoice, rate by
   * rate.
   *
   * @throws CommerceError when it would credit more than the invoice has left
   */
  public async creditNote(
    invoiceId: string,
    options: {
      reason?: string;
      amount?: number;
      lines?: RefundLine[];
    } = {},
  ): Promise<InvoiceEntity> {
    const original = await this.repo.getById(invoiceId);
    const previous = await this.repo.findMany({
      where: { creditsInvoiceId: { eq: invoiceId } },
    });

    const remaining = this.vat
      .merge([
        original.vatBuckets as VatBucket[],
        ...previous.map((note) => note.vatBuckets as VatBucket[]),
      ])
      .filter((bucket) => bucket.baseCents + bucket.vatCents !== 0);
    const left = this.vat.totals(remaining).ttcCents;

    if (left <= 0 || (options.amount ?? 0) > left) {
      throw new CommerceError(
        `Cannot credit ${options.amount ?? "the rest"} on invoice ${original.number}: ${left} is left.`,
      );
    }

    const { lines, buckets } = options.lines?.length
      ? this.creditedLines(original, options.lines)
      : options.amount !== undefined && options.amount < left
        ? this.creditedAmount(remaining, options.amount, options.reason)
        : previous.length > 0
          ? this.creditedAmount(remaining, left, options.reason, remaining)
          : this.creditedWhole(original);

    const totals = this.vat.totals(buckets);

    return this.db.transactional(async () => {
      const seller = this.seller;
      const issuedAt = this.issuedOn(seller.timezone);
      const year = Number(issuedAt.slice(0, 4));
      const seq = await this.invoiceNumber.next(`default:${year}`);

      return this.repo.create({
        number: this.formatNumber(seller.numberPrefix, year, seq),
        year,
        orderId: original.orderId,
        creditsInvoiceId: original.id,
        issuedAt,
        seller: original.seller,
        buyer: original.buyer,
        lines,
        vatBuckets: buckets,
        baseTotal: totals.baseCents,
        vatTotal: totals.vatCents,
        grandTotal: totals.ttcCents,
        currency: original.currency,
        note: options.reason,
      });
    });
  }

  /**
   * Answer a refund with its credit note, once: a retried job finds the note
   * already on the refund and stops.
   *
   * Issues the invoice first if the settlement has not got there yet: a refund
   * can arrive before it, and a credit note needs something to credit.
   */
  public async creditRefund(
    refundId: string,
  ): Promise<InvoiceEntity | undefined> {
    const { orderId } = await this.orders.refundById(refundId);

    // The same lock as `issueForOrder`, held to the end: read outside it, two
    // deliveries would both find the refund uncredited.
    return this.lock.run(
      { namespace: InvoiceService.LOCK_NAMESPACE, key: orderId },
      () =>
        this.db.transactional(async () => {
          const refund = await this.orders.refundById(refundId);
          if (refund.creditNoteId) {
            return undefined;
          }

          const invoice = await this.issue(orderId);
          const note = await this.creditNote(invoice.id, {
            reason: refund.reason ?? "Remboursement de la commande",
            amount: refund.amount,
            lines: refund.lines,
          });
          await this.orders.markRefundCredited(refund.id, note.id);
          return note;
        }),
    );
  }

  /**
   * Every line of the invoice, negated: the one credit note that can mirror it.
   */
  protected creditedWhole(original: InvoiceEntity) {
    return {
      lines: (original.lines as InvoiceLine[]).map((line) => ({
        ...line,
        quantity: -line.quantity,
        lineTotal: -line.lineTotal,
        discount: undefined,
      })),
      buckets: (original.vatBuckets as VatBucket[]).map((bucket) =>
        this.negated(bucket),
      ),
    };
  }

  /**
   * These units, at what they cost and at their own rate.
   */
  protected creditedLines(original: InvoiceEntity, refunded: RefundLine[]) {
    const invoiced = original.lines as InvoiceLine[];
    const lines = refunded.map(({ orderItemId, quantity }) => {
      const line = invoiced.find((it) => it.orderItemId === orderItemId);
      if (!line) {
        throw new CommerceError(
          `Invoice ${original.number} has no line for order line ${orderItemId}.`,
        );
      }
      return {
        ...line,
        quantity: -quantity,
        lineTotal: -Math.round((line.lineTotal * quantity) / line.quantity),
        discount: undefined,
      };
    });

    const buckets = this.vat
      .ventilate(
        lines.map((line) => ({
          ttcCents: -line.lineTotal,
          rateBps: line.rateBps,
        })),
      )
      .map((bucket) => this.negated(bucket));

    return { lines, buckets };
  }

  /**
   * One line per rate, since an amount belongs to no line in particular.
   * `exact` is what is left of the invoice, credited as it stands: the last
   * note closes every rate to the cent, whatever rounding the others did.
   */
  protected creditedAmount(
    remaining: VatBucket[],
    amount: number,
    reason?: string,
    exact?: VatBucket[],
  ) {
    const shares = exact ?? this.vat.shareOf(remaining, amount);
    return {
      lines: shares.map((share) => {
        const ttc = share.baseCents + share.vatCents;
        return {
          description: reason ?? "Remboursement partiel",
          quantity: -1,
          unitPrice: ttc,
          lineTotal: -ttc,
          rateBps: share.rateBps,
        };
      }),
      buckets: shares.map((share) => this.negated(share)),
    };
  }

  protected negated(bucket: VatBucket): VatBucket {
    return {
      rateBps: bucket.rateBps,
      baseCents: -bucket.baseCents,
      vatCents: -bucket.vatCents,
    };
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
  /**
   * Now, as an ISO instant carrying the seller's offset rather than `Z`.
   *
   * Both things this feeds are calendar facts in the seller's jurisdiction:
   * the invoice's printed date, and the year its number belongs to. Derived
   * from UTC, an invoice issued at 23:30 on 31 December in Paris was dated
   * 31 December and numbered in the closing year's series, when both should
   * have been the new one.
   *
   * Still an unambiguous instant - `2027-01-01T00:30:00+01:00`, not a naive
   * local time - so nothing that parses it loses information. What changes is
   * that `slice(0, 10)` now yields the legal date, which is what both this
   * service and `HtmlInvoiceRenderer` read.
   */
  protected issuedOn(timezone: string): string {
    return this.dateTime.now().tz(timezone).format();
  }

  protected formatNumber(
    prefix: string,
    year: number,
    sequence: number,
  ): string {
    return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
  }
}
