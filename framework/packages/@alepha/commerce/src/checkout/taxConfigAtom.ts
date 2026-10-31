import { $atom, type Infer, z } from "alepha";

/**
 * What one country charges, for a shop selling there under OSS.
 */
export const countryTaxSchema = z.object({
  /**
   * The country's standard rate, in basis points.
   */
  standardBps: z.integer().min(0).max(10000),
  /**
   * The shop's reduced rates at home, mapped to this country's: `{ "550": 700 }`
   * says what is 5,5 % in France is 7 % in Germany. Keyed by the home rate
   * because that is what a product carries.
   */
  reduced: z.record(z.text(), z.integer().min(0).max(10000)).optional(),
});

export const taxConfig = $atom({
  name: "alepha.commerce.tax",
  description: "VAT rules: the home rate, distance selling, reverse charge.",
  schema: z.object({
    defaultRateBps: z
      .integer()
      .min(0)
      .max(10000)
      .describe(
        "The rate of a product that sets none, and of delivery, in basis points. 2000 = 20.00 %.",
      ),
    originCountry: z
      .text({ minLength: 2, maxLength: 2 })
      .describe("Where the shop is established: ISO 3166-1 alpha-2."),
    distanceSelling: z
      .boolean()
      .describe(
        "Charge the delivery country's rate (OSS). Required past the EU's 10,000 euro threshold of cross-border B2C sales. Prices stay tax-inclusive, so the buyer pays the same figure and the shop keeps what the rate leaves.",
      ),
    countries: z
      .record(z.text(), countryTaxSchema)
      .describe(
        "Rates per delivery country, for distance selling. Empty by default on purpose: rates change, and a table shipped in a package goes stale in silence. A country missing here refuses the checkout rather than guess.",
      ),
    reverseCharge: z
      .boolean()
      .describe(
        "Sell without VAT to a business in another EU country with a valid VAT number.",
      ),
  }),
  default: {
    defaultRateBps: 2000,
    originCountry: "FR",
    distanceSelling: false,
    countries: {},
    reverseCharge: false,
  },
  serverOnly: true,
});

export type TaxConfig = Infer<typeof taxConfig.schema>;

declare module "alepha" {
  interface State {
    [taxConfig.key]: TaxConfig;
  }
}
