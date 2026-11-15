import { type Infer, z } from "alepha";

/**
 * The viewer's subscription in one project, to the presets one toggle names
 * within its scope (#Q3635): whether they own an enabled rule the toggle
 * created from each of them.
 */
export const automationSubscriptionSchema = z
  .object({
    subscribed: z.boolean(),
    /** The first enabled rule, when subscribed. */
    automationId: z.uuid().optional(),
    /** The channel the rule notifies on, when subscribed. */
    channel: z.string().max(64).optional(),
    /**
     * Every channel the subscription notifies on, one marked rule each
     * (#Q3602): `channel` is the first of them.
     */
    channels: z.array(z.string().max(64)).max(8).optional(),
  })
  .strict();
export type AutomationSubscription = Infer<typeof automationSubscriptionSchema>;
