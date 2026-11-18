import { type Infer, z } from "alepha";

/**
 * Add a channel (#Q3614, #Q3900): a Discord channel by its webhook URL, or a
 * webhook endpoint by the URL Lore calls. The URL travels in this body; a
 * Discord one never comes back.
 */
export const projectChannelCreateBodySchema = z
  .object({
    kind: z.enum(["discord", "webhook"]).optional(),
    name: z.string().min(1).max(64),
    url: z.string().min(1).max(2048),
  })
  .strict();

export type ProjectChannelCreateBody = Infer<
  typeof projectChannelCreateBodySchema
>;
