import { type Infer, z } from "alepha";

/**
 * What a member's page sends on the chat socket (#E161): that they are
 * typing in a room (#Q3940). The server relays it to the room's other
 * readers and stores nothing.
 */
export const chatClientFrameSchema = z.union([
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("typing"),
    projectId: z.integer(),
    roomId: z.uuid(),
  }),
]);

export type ChatClientFrame = Infer<typeof chatClientFrameSchema>;
