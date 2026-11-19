import { type Infer, z } from "alepha";

import { chatMessageResourceSchema } from "./chatMessageResourceSchema.ts";

/**
 * What the chat socket sends a member (#E161). One socket per member carries
 * every project they are in, so every frame names its project and room.
 *
 * A frame is a hint, never the record: the database is the source of truth,
 * and a page that reconnects refetches over HTTP.
 */
export const chatServerFrameSchema = z.union([
  z.object({
    type: z.literal("message.created"),
    projectId: z.integer(),
    roomId: z.uuid(),
    message: chatMessageResourceSchema,
  }),
  z.object({
    type: z.literal("message.updated"),
    projectId: z.integer(),
    roomId: z.uuid(),
    message: chatMessageResourceSchema,
  }),
  z.object({
    type: z.literal("message.deleted"),
    projectId: z.integer(),
    roomId: z.uuid(),
    messageId: z.uuid(),
  }),
  z.object({
    type: z.literal("room.changed"),
    projectId: z.integer(),
    roomId: z.uuid(),
  }),
]);

export type ChatServerFrame = Infer<typeof chatServerFrameSchema>;
