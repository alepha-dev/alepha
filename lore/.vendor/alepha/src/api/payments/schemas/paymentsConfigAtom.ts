import { $atom, type Infer, z } from "alepha";

export const paymentsConfig = $atom({
  name: "alepha.api.payments",
  description: "Cadences for the payments module's background sweeps.",
  schema: z.object({
    expireStaleIntentsCron: z
      .text()
      .describe(
        "Cron expression for the stale-intent sweep. Bounds how long an intent whose webhook never arrived sits in 'processing' past the 30-minute cutoff, so the worst case is the cutoff plus one tick. The sweep polls the PSP before expiring anything, and each stale intent costs one round-trip — on a serverless runtime that shares the invocation's subrequest budget with every other job on the same tick, which is the reason to keep this coarse rather than fine.",
      ),
  }),
  default: {
    expireStaleIntentsCron: "*/15 * * * *",
  },
  serverOnly: true,
});

export type PaymentsConfig = Infer<typeof paymentsConfig.schema>;

declare module "alepha" {
  interface State {
    [paymentsConfig.key]: PaymentsConfig;
  }
}
