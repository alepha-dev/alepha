import { type Infer, z } from "alepha";

/**
 * Which subscription to read (#Q3635): the presets its toggle names, comma
 * separated, and its scope in the canonical form of
 * `AutomationSubscriptionScope.encode`, empty for none.
 */
export const automationSubscriptionQuerySchema = z
  .object({
    presets: z.string().min(1).max(512),
    scope: z.string().max(255).optional(),
  })
  .strict();
export type AutomationSubscriptionQuery = Infer<
  typeof automationSubscriptionQuerySchema
>;
