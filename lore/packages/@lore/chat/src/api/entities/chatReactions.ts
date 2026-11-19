import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { chatMessages } from "./chatMessages.ts";
import { chatRooms } from "./chatRooms.ts";

/**
 * One member's emoji under one message (#E161, #Q3939): a row per member
 * and emoji, so a second click removes it.
 */
export const chatReactions = $entity({
  name: "chat_reactions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    messageId: db.ref(z.uuid(), () => chatMessages.cols.id, {
      onDelete: "cascade",
    }),
    roomId: db.ref(z.uuid(), () => chatRooms.cols.id, {
      onDelete: "cascade",
    }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    emoji: z.text({ maxLength: 16 }),
  }),
  indexes: [
    { columns: ["messageId", "userId", "emoji"], unique: true },
    { columns: ["userId"] },
  ],
});

export type ChatReaction = Infer<typeof chatReactions.schema>;
