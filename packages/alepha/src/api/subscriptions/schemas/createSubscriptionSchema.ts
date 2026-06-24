import { type Static, z } from "alepha";

export const createSubscriptionSchema = z.object({
  planId: z.string(),
  interval: z.enum(["monthly", "yearly"]),
  paymentMethodId: z.uuid().optional(),
  skipTrial: z.boolean().optional(),
  metadata: z.record(z.text(), z.any()).optional(),
});

export type CreateSubscription = Static<typeof createSubscriptionSchema>;
