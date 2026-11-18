import { type Infer, z } from "alepha";

/**
 * A project's subscriptions, in a path.
 */
export const subscriptionProjectParamsSchema = z.object({
  projectId: z.integer(),
});

export type SubscriptionProjectParams = Infer<
  typeof subscriptionProjectParamsSchema
>;
