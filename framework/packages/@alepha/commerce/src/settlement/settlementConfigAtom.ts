import { $atom, type Infer, z } from "alepha";

export const settlementConfig = $atom({
  name: "alepha.commerce.settlement",
  description: "Timings for the checkout reconciliation job.",
  schema: z.object({
    reconcileAfterMinutes: z
      .integer()
      .min(1)
      .describe(
        "How long a checkout may sit in 'paying' before the reconciliation polls the PSP and settles or abandons it. Kept under the payment module's 30-minute intent expiry so reconciliation gets first shot; that expiry sweep itself polls the PSP before expiring, as the fleet-wide net.",
      ),
  }),
  default: {
    reconcileAfterMinutes: 25,
  },
  serverOnly: true,
});

export type SettlementConfig = Infer<typeof settlementConfig.schema>;

declare module "alepha" {
  interface State {
    [settlementConfig.key]: SettlementConfig;
  }
}
