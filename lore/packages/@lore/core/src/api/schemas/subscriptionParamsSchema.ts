import { type Infer, z } from "alepha";

/**
 * One subscription of a project, in a path.
 */
export const subscriptionParamsSchema = z.object({
  projectId: z.integer(),
  id: z.uuid(),
});

export type SubscriptionParams = Infer<typeof subscriptionParamsSchema>;
