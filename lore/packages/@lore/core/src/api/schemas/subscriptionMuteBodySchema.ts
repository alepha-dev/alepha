import { type Infer, z } from "alepha";

/**
 * Mute or unmute one's own subscription (#Q3890).
 */
export const subscriptionMuteBodySchema = z.object({
  muted: z.boolean(),
});

export type SubscriptionMuteBody = Infer<typeof subscriptionMuteBodySchema>;
