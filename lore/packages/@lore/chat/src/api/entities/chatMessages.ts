import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { chatRooms } from "./chatRooms.ts";

/**
 * One message of a room (#E161, #Q3926).
 *
 * Written by a member (`authorId`) or by an agent (`agent`, the handle it was
 * mentioned by, `lore` or `jarvis`, and `agentId` for a project's own). An
 * agent's message also carries `aiMessageId`, the framework's `ai_messages`
 * row its text mirrors: `ai_*` stays the run log
 * (budget, rate limit, paused calls, audit, retention), and the room keeps a
 * copy of the answer.
 *
 * A deleted message keeps its row and loses its body, so the conversation
 * does not shift and a reply still has something to point at. The id is a
 * UUIDv7, ordered by time: the list pages backwards by it, and a member's
 * read state is the newest id they read.
 */
export const chatMessages = $entity({
  name: "chat_messages",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    roomId: db.ref(z.uuid(), () => chatRooms.cols.id, {
      onDelete: "cascade",
    }),
    authorId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    agent: z.text({ maxLength: 40 }).optional(),
    /**
     * The project's `chat_agents` row that wrote it (#Q4196), none for
     * `@lore`. Its name and avatar are read from that row, so a rename shows
     * on past answers too. No foreign key: an agent is soft-deleted.
     */
    agentId: z.uuid().optional(),
    /**
     * Markdown, capped by {@link chatMessageBodySchema}. Empty once deleted.
     */
    body: z.text({ size: "rich" }),
    /**
     * The `#Q12`, `[[#F7]]` references the body names, parsed at write in
     * the grammar `ResourceLinkService` reads (`Q12`, `F7`). Kept on the
     * message, never in core's link graph: a backlink from a quest to a
     * private room's message would show it to every reader of the quest.
     */
    references: db.default(z.array(z.text({ maxLength: 20 })), []),
    editedAt: z.datetime().optional(),
    deletedAt: z.datetime().optional(),
    /**
     * The `ai_messages` row an agent message mirrors. No foreign key: the
     * framework's retention purges `ai_*` on its own schedule, and the room
     * keeps its copy.
     */
    aiMessageId: z.uuid().optional(),
    /**
     * The files the message carries (#Q3939), in the `chat-attachments`
     * bucket. No column default: one on D1 is a table rebuild.
     */
    attachments: z.array(z.uuid()).optional(),
    /**
     * An agent's answer while and after it runs (#Q3930): whose run it is,
     * and the write it waits on when it paused. The run itself is logged in
     * `ai_*`; this is what the room shows.
     */
    agentRun: z
      .object({
        status: z.enum(["running", "paused", "done", "failed"]),
        mentionerId: z.uuid(),
        callId: z.text().optional(),
        tool: z.text().optional(),
        /**
         * The host job answering it (#Q4250), on a host agent's answer:
         * written from the job's result when the job ends.
         */
        jobId: z.uuid().optional(),
        /**
         * The host session the turn used, made resumable once it ends done.
         */
        sessionKey: z.text().optional(),
        /**
         * Asked by an automation (#Q4236): dropped when it has nothing.
         */
        unasked: z.boolean().optional(),
        input: z.record(z.text(), z.any()).optional(),
        /**
         * The tools the run used, in order: the answer's trace line.
         */
        tools: z
          .array(
            z.object({
              name: z.text(),
              state: z.enum(["running", "done", "failed"]),
            }),
          )
          .optional(),
      })
      .optional(),
  }),
  indexes: [{ columns: ["roomId", "id"] }, { columns: ["authorId"] }],
});

export type ChatMessage = Infer<typeof chatMessages.schema>;
