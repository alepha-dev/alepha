import { type Infer, z } from "alepha";

/**
 * An agent that has answered in a room, as its members panel lists it
 * beside the people (#Q4268).
 */
export const chatRoomAgentResourceSchema = z.object({
  /**
   * The handle it answered to, `lore` or a project agent's.
   */
  handle: z.text({ maxLength: 40 }),
  /**
   * A project agent's id; none for the built-in `@lore`.
   */
  agentId: z.uuid().optional(),
  /**
   * A project agent's name; the page names `@lore` itself.
   */
  name: z.text().optional(),
  /**
   * A project agent's picture, a file of the `chat-agent-avatars` bucket.
   */
  avatarId: z.text().optional(),
});

export type ChatRoomAgentResource = Infer<typeof chatRoomAgentResourceSchema>;
