import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { chatMessages } from "./chatMessages.ts";
import { chatRooms } from "./chatRooms.ts";

/**
 * A member a message mentions (#E161, #Q3926), parsed from its `@username`
 * when it is written or edited.
 *
 * A table rather than a column of the message: the unread-mention count of
 * every room is one indexed join, the notification quest reads who to tell,
 * and the agent quest reads whether `@lore` was asked. An agent mention has
 * `agent` and no `userId`.
 */
export const chatMentions = $entity({
  name: "chat_mentions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    messageId: db.ref(z.uuid(), () => chatMessages.cols.id, {
      onDelete: "cascade",
    }),
    roomId: db.ref(z.uuid(), () => chatRooms.cols.id, {
      onDelete: "cascade",
    }),
    userId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    agent: z.text({ maxLength: 40 }).optional(),
    /**
     * The project's agent the handle named (#Q4196), none for `@lore`.
     */
    agentId: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["userId", "roomId", "messageId"] },
    { columns: ["messageId"] },
  ],
});

export type ChatMention = Infer<typeof chatMentions.schema>;
