import { type Static, z } from "alepha";

/**
 * Public body for the self-service subscribe endpoint.
 *
 * Deliberately does NOT expose `skipTrial` (or a `paymentMethodId`): skipping
 * the trial goes straight to a paid `active` subscription with no captured
 * payment, so it must never be client-controlled. Trusted server-side callers
 * pass `skipTrial` through the `SubscriptionService.subscribe` options after a
 * payment is captured — it is not part of the public request.
 */
export const createSubscriptionSchema = z.object({
  planId: z.string(),
  interval: z.enum(["monthly", "yearly"]),
  metadata: z.record(z.text(), z.any()).optional(),
});

export type CreateSubscription = Static<typeof createSubscriptionSchema>;
