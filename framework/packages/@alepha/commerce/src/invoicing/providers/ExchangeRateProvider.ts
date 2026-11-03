/**
 * What one unit of a currency was worth on a day.
 *
 * Prices never read this: a price list is written by hand, and a sale is billed
 * in the currency it was made in. It exists for one line of an invoice. An EU
 * invoice may be in any currency, but the VAT payable has to appear in the
 * seller's own as well (article 230 of the VAT directive), at a rate the tax
 * administration accepts.
 *
 * Which source that is, is the seller's call: the ECB's daily reference rate, the
 * customs rate of the month. So the default knows none, and an invoice issued
 * without one goes out without the line and says so in the log. Substitute this
 * class before selling with VAT in a foreign currency.
 *
 * ```ts
 * alepha.with({ provide: ExchangeRateProvider, use: EcbRates });
 * ```
 */
export class ExchangeRateProvider {
  /**
   * How much of `to` one `from` is worth on a day, `YYYY-MM-DD`.
   */
  public async rate(
    _from: string,
    _to: string,
    _on: string,
  ): Promise<number | undefined> {
    return undefined;
  }
}
