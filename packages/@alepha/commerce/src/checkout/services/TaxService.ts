import type { PricedCart } from "../../cart/services/CartService.ts";

/** What the tax computation returns. */
export interface TaxResult {
  /** Total tax, in the smallest currency unit. */
  total: number;
  /** Per-rate breakdown, in basis points → amount. What an invoice needs. */
  byRate: Record<number, number>;
}

/**
 * Tax on a cart.
 *
 * The default is a single inclusive rate, which is exactly right for an EU
 * seller below the €10k distance-selling threshold: they charge their own
 * country's rate on every B2C sale regardless of destination, so the
 * destination address does not enter the computation.
 *
 * Above that threshold it does, and this is the seam: substitute a
 * destination-aware implementation and nothing else changes.
 *
 * ```ts
 * alepha.with({ provide: TaxService, use: OssTaxService });
 * ```
 *
 * A separate module would be overkill for one method — DI substitution is
 * already the extension point.
 */
export class TaxService {
  /**
   * Rate in basis points. 2000 = 20.00 %, the French standard rate.
   *
   * Prices in this domain are tax-inclusive, which is the legal requirement for
   * B2C display in the EU: the customer sees one number and pays it. So this
   * extracts the tax already contained in the total rather than adding to it.
   */
  public static readonly DEFAULT_RATE_BPS = 2000;

  public rateBps(): number {
    return TaxService.DEFAULT_RATE_BPS;
  }

  /**
   * Extract the tax contained in a tax-inclusive cart.
   *
   * Each line is taxed at its product's own rate, falling back to
   * {@link rateBps} where the catalog sets none. Lines sharing a rate are
   * summed *before* the split, so a rate rounds once rather than once per line
   * — the same rule the invoice applies, which is what keeps the figure quoted
   * at checkout equal to the one on the document that follows it.
   *
   * Per rate: `tax = gross − gross / (1 + rate)`, rounded to the smallest unit.
   */
  public compute(cart: PricedCart, shippingTotal = 0): TaxResult {
    const grossByRate = new Map<number, number>();
    const add = (rate: number, gross: number) =>
      grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross);

    for (const line of cart.lines) {
      add(line.rateBps ?? this.rateBps(), line.lineTotal);
    }
    // Delivery bills at the seller's default: a mixed-rate basket has no single
    // "rate of the goods" for it to inherit. Matches InvoiceService.
    if (shippingTotal > 0) {
      add(this.rateBps(), shippingTotal);
    }

    const byRate: Record<number, number> = {};
    let total = 0;
    for (const [rate, gross] of [...grossByRate].sort((a, b) => a[0] - b[0])) {
      const tax = gross - Math.round((gross * 10000) / (10000 + rate));
      byRate[rate] = tax;
      total += tax;
    }
    return { total, byRate };
  }
}
