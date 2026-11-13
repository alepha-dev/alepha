import { type Infer, z } from "alepha";

/**
 * The viewer's subscription to one preset in one project: whether they own
 * an enabled rule a subscription toggle created from it.
 */
export const automationSubscriptionSchema = z
  .object({
    subscribed: z.boolean(),
    /** The enabled rule, when subscribed. */
    automationId: z.uuid().optional(),
    /** The channel the rule notifies on, when subscribed. */
    channel: z.string().max(64).optional(),
  })
  .strict();
export type AutomationSubscription = Infer<typeof automationSubscriptionSchema>;
