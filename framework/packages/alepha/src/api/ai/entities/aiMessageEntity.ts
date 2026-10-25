import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One message of a conversation, in `seq` order: the user's (with its page
 * context, as the model saw it), the assistant's (with its tool calls, the
 * model, and the tokens it cost), or one tool result.
 *
 * `userId` is the conversation's, denormalized so the per-user budget is one
 * indexed sum over this table, without a join.
 *
 * No foreign key to `ai_conversations`: the service deletes a
 * conversation's messages itself, so nothing depends on a cascade.
 */
export const aiMessageEntity = $entity({
  name: "ai_messages",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    conversationId: z.uuid(),
    userId: z.text({ maxLength: 128 }),
    seq: z.integer(),
    role: z.enum(["user", "assistant", "tool"]),
    content: z.text({ size: "rich" }),
    toolCalls: z.array(z.record(z.text(), z.any())).nullable().optional(),
    callId: z.text({ maxLength: 128 }).nullable().optional(),
    name: z.text({ maxLength: 64 }).nullable().optional(),
    isError: z.boolean().nullable().optional(),
    vendor: z.record(z.text(), z.any()).nullable().optional(),
    model: z.text({ maxLength: 128 }).nullable().optional(),
    inputTokens: z.integer().nullable().optional(),
    outputTokens: z.integer().nullable().optional(),
  }),
  indexes: [
    // The budget sum: one user's rows over a window.
    { columns: ["userId", "createdAt"] },
    // A conversation's messages in order.
    { columns: ["conversationId", "seq"] },
  ],
});

export type AiMessageEntity = Infer<typeof aiMessageEntity.schema>;
