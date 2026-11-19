import { z } from "alepha";

/**
 * What a member's page sends on the chat socket (#E161): nothing that
 * writes. Messages are sent over HTTP, where the rank and the rate limit
 * apply; the socket carries only what is never stored, like "is typing".
 */
export const chatClientFrameSchema = z.object({
  type: z.literal("ping"),
});
