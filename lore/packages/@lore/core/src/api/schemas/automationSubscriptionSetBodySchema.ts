import { type Infer, z } from "alepha";

export const automationSubscriptionSetBodySchema = z
  .object({
    subscribed: z.boolean(),
    /**
     * The preset's setup values, such as its `channel`, read when turning
     * the subscription on. The recipient is always the caller, and is not
     * one of them.
     */
    values: z
      .record(z.string().max(64), z.string().max(255))
      .refine((values) => Object.keys(values).length <= 16)
      .optional(),
    /**
     * The channels to notify on, at least one (#Q3602): the subscription is
     * one marked rule per channel, each a copy of the preset with its own
     * `channel`. Read when turning the subscription on; sending a different
     * set to a live subscription replaces its rules.
     */
    channels: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
  })
  .strict();
export type AutomationSubscriptionSetBody = Infer<
  typeof automationSubscriptionSetBodySchema
>;
