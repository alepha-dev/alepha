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
   * Extract the tax contained in a tax-inclusive amount.
   *
   * `tax = gross − gross / (1 + rate)`, rounded half-up to the smallest unit.
   */
  public compute(cart: PricedCart, shippingTotal = 0): TaxResult {
    const gross = cart.subtotal + shippingTotal;
    const rate = this.rateBps();
    const total = gross - Math.round((gross * 10000) / (10000 + rate));
    return { total, byRate: { [rate]: total } };
  }
}
