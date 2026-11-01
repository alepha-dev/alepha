import { $atom, type Infer, z } from "alepha";

export const orderConfig = $atom({
  name: "alepha.commerce.orders",
  description: "How orders are numbered, and how long they can be sent back.",
  schema: z.object({
    numberPrefix: z
      .text({ maxLength: 8 })
      .describe(
        "Prefix of the order number, as in `CMD-2026-000123`. A reference for the phone, the support desk and the parcel label; the legal numbering is the invoice's.",
      ),
    locale: z
      .text({ maxLength: 8 })
      .describe(
        "The language of invoices, credit notes and the default emails: `fr` and `en` ship, see `CommerceTexts` for any other.",
      ),
    baseCurrency: z
      .text({ minLength: 3, maxLength: 3 })
      .describe(
        "The currency of the seller's books: what an empty cart reads, what a delivery rate or a promotion naming none is in, and what an invoice in another currency states its VAT in.",
      ),
    currencies: z
      .array(z.text({ minLength: 3, maxLength: 3 }))
      .describe(
        "What a buyer may choose between. Each needs its price list, its delivery rates and an amount in cents with two decimals: a zero-decimal currency such as JPY does not work.",
      ),
    withdrawalDays: z
      .integer()
      .min(0)
      .describe(
        "Days a customer has to request a return, from delivery, or from shipping when nobody marked the order delivered. Fourteen is the EU minimum for a distance sale; a shop may give more.",
      ),
  }),
  default: {
    numberPrefix: "CMD",
    locale: "fr",
    baseCurrency: "EUR",
    currencies: ["EUR"],
    withdrawalDays: 14,
  },
  serverOnly: true,
});

export type OrderConfig = Infer<typeof orderConfig.schema>;

declare module "alepha" {
  interface State {
    [orderConfig.key]: OrderConfig;
  }
}
