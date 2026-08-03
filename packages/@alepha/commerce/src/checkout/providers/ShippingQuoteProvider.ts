/** One delivery option, priced for a specific cart. */
export interface CheckoutShippingQuote {
  /** Written onto the order as `shippingMethod`. */
  code: string;
  name: string;
  /** What this cart pays, in the smallest currency unit. */
  price: number;
  minDays?: number;
  maxDays?: number;
}

/**
 * Where the checkout asks what delivery costs.
 *
 * ### Why this indirection exists
 *
 * `checkout` must not depend on `@alepha/commerce/shipping`. Ticketing has a
 * cart and a checkout and ships *nothing* — a hard dependency would put two
 * shipping tables into its migrations forever. So the checkout asks an
 * abstraction, and the shipping module answers it by substitution.
 *
 * The default answers "no options", which is the correct behaviour for a shop
 * that sells only downloads: delivery costs nothing and has no name.
 */
export abstract class ShippingQuoteProvider {
  /**
   * Options for a destination, or an empty array when delivery does not apply.
   */
  abstract quote(
    country: string,
    subtotal: number,
  ): Promise<CheckoutShippingQuote[]>;

  /**
   * Price one already-chosen option. Returns `undefined` when the code is not
   * available for that destination, which the checkout treats as "the buyer's
   * selection is stale, re-ask".
   */
  abstract quoteFor(
    country: string,
    subtotal: number,
    code: string,
  ): Promise<CheckoutShippingQuote | undefined>;
}

/**
 * The default: nothing ships, so nothing is charged.
 *
 * Registered by `alepha.commerce.checkout` unless another module claims the
 * slot. A dematerialised shop never notices this class exists.
 */
export class NoShippingQuoteProvider extends ShippingQuoteProvider {
  public async quote(): Promise<CheckoutShippingQuote[]> {
    return [];
  }

  public async quoteFor(): Promise<CheckoutShippingQuote | undefined> {
    return undefined;
  }
}
