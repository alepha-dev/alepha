import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Message type determines how the message is rendered:
 * - comment: Regular user comment (chat bubble)
 * - system: System-generated event (inline notification)
 * - status_change: Issue status changed (special event)
 * - assignment: Agent assigned/unassigned (special event)
 * - note: Internal note (only visible to agents)
 */
export type IssueMessageType =
  | "comment"
  | "system"
  | "status_change"
  | "assignment"
  | "note";

/**
 * Who authored the message
 */
export type IssueMessageAuthorType = "system" | "customer" | "agent";

/**
 * Issue messages - chat-like communication on issues.
 *
 * Supports both regular comments and system events (status changes,
 * assignments) displayed inline in the timeline.
 */
export const issueMessages = $entity({
  name: "issue_messages",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    // Parent issue
    issueId: t.uuid(),

    // Message type
    messageType: pg.default(
      pg.enum(["comment", "system", "status_change", "assignment", "note"]),
      "comment",
    ),

    // Author information
    authorType: pg.enum(["system", "customer", "agent"]),
    authorId: t.optional(t.uuid()), // Null for system messages
    authorName: t.optional(t.text()), // Denormalized for display

    // Content
    content: t.text({ maxLength: 10000 }),

    // For system events, store structured data
    eventData: t.optional(
      t.object({
        previousStatus: t.optional(t.text()),
        newStatus: t.optional(t.text()),
        previousAgentId: t.optional(t.uuid()),
        newAgentId: t.optional(t.uuid()),
        newAgentName: t.optional(t.text()),
      }),
    ),

    // Editing
    editedAt: t.optional(t.datetime()),
    isDeleted: pg.default(t.boolean(), false),
  }),
  indexes: [
    { columns: ["issueId"] },
    { columns: ["authorType"] },
    { columns: ["authorId"] },
    { columns: ["messageType"] },
    { columns: ["createdAt"] },
  ],
});

export type IssueMessage = Static<typeof issueMessages.schema>;
