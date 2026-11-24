import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { chatRooms } from "./chatRooms.ts";

/**
 * A member of a room (#E161).
 *
 * In a private room the row IS the right to see it. In an open room it says
 * the member joined: every project member who reads chat sees an open room
 * either way, and the row carries what is theirs in it, the read state and
 * the notify level the messages quest fills.
 */
export const chatRoomMembers = $entity({
  name: "chat_room_members",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    roomId: db.ref(z.uuid(), () => chatRooms.cols.id, {
      onDelete: "cascade",
    }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    joinedAt: db.createdAt(),
    /**
     * The newest message this member has read, or none yet. No foreign key:
     * a deleted message keeps its row, and the read state must survive a
     * purge.
     */
    lastReadMessageId: z.uuid().optional(),
    /**
     * `mentions` (the default) notifies on a mention only, `muted` never.
     */
    notifyLevel: db.default(
      z.enum(["mentions", "muted"]).meta({ mode: "text" }),
      "mentions",
    ),
    /**
     * ⚠️ Unread since #Q4197, replaced by `aiConversations`, whose `lore`
     * key the migration filled from it. Kept until its drop ships alone.
     */
    aiConversationId: z.uuid().optional(),
    /**
     * The `ai_conversations` row this member's runs in this room continue,
     * per agent (#Q3930, #Q4197): keyed by `lore` or a project agent's id,
     * so `@jarvis` never continues `@lore`'s thread.
     */
    aiConversations: z.record(z.text(), z.uuid()).optional(),
  }),
  indexes: [
    { columns: ["roomId", "userId"], unique: true },
    { columns: ["userId"] },
  ],
});

export type ChatRoomMember = Infer<typeof chatRoomMembers.schema>;
