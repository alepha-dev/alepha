import { type Infer, z } from "alepha";

export const automationSubscriptionSetBodySchema = z
  .object({
    /**
     * The presets one toggle covers, at least one (#Q3635): a monitor's
     * bell names both `monitor-down` and `monitor-up`.
     */
    presets: z.array(z.string().min(1).max(128)).min(1).max(8),
    /**
     * The setup values this bell binds, such as `{ monitor: "<id>" }`. They
     * are the subscription's identity beside its presets and its author, and
     * are set on every rule it makes; `values` cannot override them.
     */
    scope: z
      .record(z.string().min(1).max(64), z.string().min(1).max(128))
      .refine((value) => Object.keys(value).length <= 4)
      .optional(),
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
     * one marked rule per preset and channel, each a copy of the preset with
     * its own `channel`. Read when turning the subscription on; sending a different
     * set to a live subscription replaces its rules.
     */
    channels: z.array(z.string().min(1).max(64)).min(1).max(8).optional(),
  })
  .strict();
export type AutomationSubscriptionSetBody = Infer<
  typeof automationSubscriptionSetBodySchema
>;
