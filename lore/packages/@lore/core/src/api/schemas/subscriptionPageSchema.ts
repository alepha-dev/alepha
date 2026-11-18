import { type Infer, z } from "alepha";

import { subscriptionResourceSchema } from "./subscriptionResourceSchema.ts";

/**
 * A project's subscriptions the caller may see: all of them with
 * `subscription:read`, their own otherwise (#Q3890).
 */
export const subscriptionPageSchema = z.object({
  items: z.array(subscriptionResourceSchema),
});

export type SubscriptionPage = Infer<typeof subscriptionPageSchema>;
