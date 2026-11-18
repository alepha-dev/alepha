import { type Infer, z } from "alepha";

/**
 * Add a channel, or rename it and replace its URL (#Q3614). The URL travels
 * only in this body, never back.
 */
export const automationChannelWriteBodySchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    url: z.string().min(1).max(2048).optional(),
  })
  .strict();
export type AutomationChannelWriteBody = Infer<
  typeof automationChannelWriteBodySchema
>;
