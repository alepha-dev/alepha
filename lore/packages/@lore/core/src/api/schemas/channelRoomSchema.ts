import { type Infer, z } from "alepha";

/**
 * A chat room a notification channel may post into (#Q4052).
 */
export const channelRoomSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(80),
});

export type ChannelRoomResource = Infer<typeof channelRoomSchema>;
