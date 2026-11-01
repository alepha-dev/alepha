import { $inject } from "alepha";

import {
  type CheckoutShippingQuote,
  ShippingQuoteProvider,
  type ShippingQuoteContext,
} from "../../checkout/providers/ShippingQuoteProvider.ts";
import { ShippingService } from "../services/ShippingService.ts";

/**
 * Answers the checkout's shipping question from the zone/rate tables.
 *
 * This is the whole of the link between the two modules: `shipping` implements
 * an interface that `checkout` declares. The arrow points from the plugin to the
 * extension point, never the other way, so a consumer that imports only
 * `checkout` never learns these tables exist.
 */
export class TableShippingQuoteProvider extends ShippingQuoteProvider {
  protected readonly shipping = $inject(ShippingService);

  public async quote(
    country: string,
    subtotal: number,
    context?: ShippingQuoteContext,
  ): Promise<CheckoutShippingQuote[]> {
    const quotes = await this.shipping.quote(country, subtotal, context);
    return quotes.map((q) => ({
      code: q.code,
      name: q.name,
      price: q.price,
      minDays: q.minDays,
      maxDays: q.maxDays,
    }));
  }

  public async quoteFor(
    country: string,
    subtotal: number,
    code: string,
    context?: ShippingQuoteContext,
  ): Promise<CheckoutShippingQuote | undefined> {
    const quotes = await this.quote(country, subtotal, context);
    return quotes.find((q) => q.code === code);
  }
}
