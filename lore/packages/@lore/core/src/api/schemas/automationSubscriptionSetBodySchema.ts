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
  })
  .strict();
export type AutomationSubscriptionSetBody = Infer<
  typeof automationSubscriptionSetBodySchema
>;
