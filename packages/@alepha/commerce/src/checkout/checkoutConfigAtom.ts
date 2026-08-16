import { $atom, type Infer, z } from "alepha";

export const checkoutConfig = $atom({
  name: "alepha.commerce.checkout",
  description: "Cadences for the checkout module's background sweeps.",
  schema: z.object({
    stockSweepCron: z
      .text()
      .describe(
        "Cron expression for the expired-hold release sweep. Safe to make coarse: `StockService.reserved` already excludes holds by `expiresAt`, so availability is correct whether or not the sweep has run. A late tick delays tidying the `status` column, it never oversells.",
      ),
  }),
  default: {
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
