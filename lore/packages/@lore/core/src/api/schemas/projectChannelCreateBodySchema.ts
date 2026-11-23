import { type Infer, z } from "alepha";

/**
 * Add a channel (#Q3614, #Q3900): a Discord channel by its webhook URL, or a
 * webhook endpoint by the URL Lore calls, or a chat room of the project by its
 * id (#Q4052). The URL travels in this body; a Discord one never comes back.
 */
export const projectChannelCreateBodySchema = z
  .object({
    kind: z.enum(["discord", "webhook", "chat"]).optional(),
    /**
     * Required, except for a `chat` channel, whose name is generated from its
     * room (`Room #general`, #Q4187).
     */
    name: z.string().min(1).max(64).optional(),
    /**
     * Discord's webhook URL or the webhook endpoint's. Not for a room.
     */
    url: z.string().min(1).max(2048).optional(),
    /**
     * A `chat` channel's room (#Q4052): an open room of the project.
     */
    roomId: z.string().min(1).max(64).optional(),
  })
  .strict();

export type ProjectChannelCreateBody = Infer<
  typeof projectChannelCreateBodySchema
>;
