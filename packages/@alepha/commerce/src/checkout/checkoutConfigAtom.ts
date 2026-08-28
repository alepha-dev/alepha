import { $atom, type Infer, z } from "alepha";

export const checkoutConfig = $atom({
  name: "alepha.commerce.checkout",
  description: "Checkout module configuration.",
  schema: z.object({
    baseUrl: z
      .text()
      .describe(
        "The storefront's public origin, e.g. `https://boutique.example`. Used to resolve the `returnUrl` a client sends at checkout: a path is resolved against it, and an absolute URL is accepted only when its origin matches. Left empty, the origin of the request itself is used - correct for a single-origin shop, but set this explicitly wherever the app is reached through a proxy that may not preserve Host.",
      ),
    stockSweepCron: z
      .text()
      .describe(
        "Cron expression for the expired-hold release sweep. Safe to make coarse: `StockService.reserved` already excludes holds by `expiresAt`, so availability is correct whether or not the sweep has run. A late tick delays tidying the `status` column, it never oversells.",
      ),
  }),
  default: {
    baseUrl: "",
    stockSweepCron: "*/15 * * * *",
  },
  serverOnly: true,
});

export type CheckoutConfig = Infer<typeof checkoutConfig.schema>;

declare module "alepha" {
  interface State {
    [checkoutConfig.key]: CheckoutConfig;
  }
}
