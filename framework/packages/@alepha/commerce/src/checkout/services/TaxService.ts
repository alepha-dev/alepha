import { $store } from "alepha";

import type { PricedCart } from "../../cart/services/CartService.ts";
import { CommerceError } from "../../errors/CommerceError.ts";
import { taxConfig } from "../taxConfigAtom.ts";

/**
 * What the tax computation returns.
 */
export interface TaxResult {
  /**
   * Total tax, in the smallest currency unit.
   */
  total: number;
  /**
   * Per-rate breakdown, in basis points → amount. What an invoice needs.
   */
  byRate: Record<number, number>;
}

/**
 * What decides the tax of a sale, beyond the lines.
 */
export interface TaxContext {
  /**
   * Where it is delivered, once known.
   */
  country?: string;
  /**
   * A business in another EU country with a valid number: no VAT at all.
   */
  reverseCharge?: boolean;
}

/**
 * A line with the VAT taken out, for a sale under reverse charge.
 */
export interface NetLine {
  unitPrice: number;
  discount: number;
}

/**
 * Tax on a cart.
 *
 * Prices in this domain are tax-inclusive, which is the legal requirement for
 * B2C display in the EU: the customer sees one number and pays it. So this
 * extracts the tax already contained in the total rather than adding to it.
 *
 * Which rate is the question {@link taxConfig} answers. The default is the
 * seller's own rate on every sale, exactly right below the EU's 10,000 euro
 * threshold of cross-border sales. With `distanceSelling` on, the delivery
 * country's rate applies instead (OSS). Substitute this class for a rule the
 * configuration cannot say.
 */
export class TaxService {
  protected readonly config = $store(taxConfig);

  /**
   * The rate of a product that sets none, and of delivery, at home.
   */
  public rateBps(): number {
    return this.config.defaultRateBps;
  }

  /**
   * The rate a sale to `country` pays, for a line carrying `lineRate` at home.
   *
   * @throws CommerceError when distance selling has no rate for it: the wrong
   *   tax on an invoice is worse than a checkout that stops.
   */
  public rateFor(lineRate: number | undefined, country?: string): number {
    const home = lineRate ?? this.rateBps();
    if (
      !this.config.distanceSelling ||
      !country ||
      country === this.config.originCountry
    ) {
      return home;
    }

    const table = this.config.countries[country];
    const rate =
      home === this.rateBps()
        ? table?.standardBps
        : table?.reduced?.[String(home)];
    if (rate === undefined) {
      throw new CommerceError(
        `No VAT rate configured for ${country} at the home rate of ${home}.`,
      );
    }
    return rate;
  }

  /**
   * Whether a sale escapes VAT: the shop sells that way, the buyer has a number
   * from another country, and the goods go there too.
   */
  public reverseCharge(vatNumber?: string, country?: string): boolean {
    const origin = this.config.originCountry;
    return Boolean(
      this.config.reverseCharge &&
      vatNumber &&
      country &&
      country !== origin &&
      !vatNumber.startsWith(origin),
    );
  }

  /**
   * Extract the tax contained in a tax-inclusive cart.
   *
   * Each line is taxed at its rate for the destination, see {@link rateFor}.
   * Lines sharing a rate are summed *before* the split, so a rate rounds once
   * rather than once per line - the same rule the invoice applies, which is what
   * keeps the figure quoted at checkout equal to the one on the document that
   * follows it.
   *
   * Per rate: `tax = gross − gross / (1 + rate)`, rounded to the smallest unit.
   */
  public compute(
    cart: PricedCart,
    shippingTotal = 0,
    context: TaxContext = {},
  ): TaxResult {
    if (context.reverseCharge) {
      return { total: 0, byRate: {} };
    }

    const grossByRate = new Map<number, number>();
    const add = (rate: number, gross: number) =>
      grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + gross);

    for (const line of cart.lines) {
      add(this.rateFor(line.rateBps, context.country), line.lineTotal);
    }
    // Delivery bills at the default rate: a mixed-rate basket has no single
    // "rate of the goods" for it to inherit. Matches InvoiceService.
    if (shippingTotal > 0) {
      add(this.rateFor(undefined, context.country), shippingTotal);
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

  /**
   * A cart with the home VAT taken out: what a business pays under reverse
   * charge, since it accounts for the VAT itself.
   *
   * Per unit, so the line still reads as a quantity at a price, and the
   * discount apart, so the order's own arithmetic holds:
   * `unitPrice * quantity - discount` is what the line costs.
   */
  public net(
    cart: PricedCart,
    shippingTotal = 0,
  ): {
    lines: Map<string, NetLine>;
    subtotal: number;
    discountTotal: number;
    shippingTotal: number;
  } {
    const lines = new Map<string, NetLine>();
    let subtotal = 0;
    let discountTotal = 0;
    for (const line of cart.lines) {
      const rate = line.rateBps ?? this.rateBps();
      const unitPrice = this.withoutVat(line.unitPrice, rate);
      const discount = this.withoutVat(line.discount, rate);
      lines.set(line.lineId, { unitPrice, discount });
      subtotal += unitPrice * line.quantity - discount;
      discountTotal += discount;
    }
    return {
      lines,
      subtotal,
      discountTotal,
      shippingTotal: this.withoutVat(shippingTotal, this.rateBps()),
    };
  }

  protected withoutVat(gross: number, rate: number): number {
    return Math.round((gross * 10000) / (10000 + rate));
  }
}
