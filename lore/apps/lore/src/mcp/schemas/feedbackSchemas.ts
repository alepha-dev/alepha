import { z } from "alepha";
import { projectParamsSchema } from "./commonSchemas.ts";

const feedbackStatusSchema = z
  .enum(["pending", "accepted", "rejected"])
  .meta({ mode: "text" });

const feedbackRefSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  tags: z.array(z.string()),
  status: feedbackStatusSchema,
  reporterName: z.string().optional(),
  linkedQuestCount: z.integer(),
  attachmentCount: z
    .integer()
    .describe(
      "How many files came with the report. Non-zero means `feedback_get` will list them and `feedback_attachment_get` shows an image inline, which on a bug report is usually the screenshot that explains it.",
    ),
  createdAt: z.datetime(),
});

const feedbackLinkedQuestRefSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  status: z.enum(["new", "accepted", "completed"]).meta({ mode: "text" }),
});

const feedbackAttachmentRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
});

/**
 * One row of a feedback item's thread. Mirrors `questCommentSchema`: the
 * author is a display name rather than a uuid, and `authorKind` says
 * whether a machine wrote it, which over MCP is the only thing that can.
 */
const feedbackCommentRefSchema = z.object({
  id: z.integer(),
  author: z.string().optional(),
  authorKind: z
    .enum(["human", "agent"])
    .describe(
      "Who actually wrote this. Over MCP the session user is the project owner's account, so on an agent-written comment the name says nothing about who to answer.",
    ),
  body: z.string(),
  createdAt: z.datetime(),
  editedAt: z.datetime().optional(),
});

const feedbackFullSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  status: feedbackStatusSchema,
  reporterName: z.string().optional(),
  attachments: z.array(feedbackAttachmentRefSchema),
  linkedQuests: z.array(feedbackLinkedQuestRefSchema),
  discussion: z
    .array(feedbackCommentRefSchema)
    .describe(
      "The item's thread, oldest first. Both project members and the reporter can write here, which is what makes it the place to ask a reporter a question. Capped at the most recent 50; `discussionTruncated` says whether older ones were dropped.",
    ),
  discussionTruncated: z
    .boolean()
    .describe(
      "True when the thread above is only the most recent slice. Nothing here fetches the rest: open the item in Lore.",
    ),
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// feedback_list
// -----------------------------------------------------------------------------

export const feedbackListParamsSchema = projectParamsSchema.extend({
  status: z
    .enum(["pending", "accepted", "rejected", "all"])
    .meta({ mode: "text" })
    .describe("Filter by status. Defaults to 'pending' (inbox triage).")
    .optional(),
});

export const feedbackListResultSchema = z.object({
  feedback: z.array(feedbackRefSchema),
});

// -----------------------------------------------------------------------------
// feedback_get
// -----------------------------------------------------------------------------

export const feedbackGetParamsSchema = projectParamsSchema.extend({
  id: z
    .integer()
    .describe("Global feedback ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-project 1-based shortId. Requires `project` or `project_name`.",
    )
    .optional(),
});

export const feedbackGetResultSchema = feedbackFullSchema;

// -----------------------------------------------------------------------------
// feedback_attachment_get
// -----------------------------------------------------------------------------

export const feedbackAttachmentGetParamsSchema = projectParamsSchema.extend({
  id: z
    .integer()
    .describe("Global feedback ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-project 1-based shortId. Requires `project` or `project_name`.",
    )
    .optional(),
  attachmentId: z
    .uuid()
    .describe(
      "Attachment id to fetch — one of the `attachments[].id` values returned by feedback_get.",
    ),
});

// feedback_attachment_get returns raw MCP content blocks (an `image` block for
// images, otherwise a `text` block), so it declares no `result` schema.

// -----------------------------------------------------------------------------
// feedback_accept / feedback_reject
// -----------------------------------------------------------------------------

export const feedbackTriageParamsSchema = projectParamsSchema.extend({
  id: z
    .integer()
    .describe("Global feedback ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-project 1-based shortId. Requires `project` or `project_name`.",
    )
    .optional(),
});

export const feedbackTriageResultSchema = z.object({
  ok: z.boolean(),
});

// -----------------------------------------------------------------------------
// feedback_comment_add
// -----------------------------------------------------------------------------

export const feedbackCommentAddParamsSchema = projectParamsSchema.extend({
  id: z
    .integer()
    .describe("Global feedback ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-project 1-based shortId. Requires `project` or `project_name`.",
    )
    .optional(),
  body: z
    .string()
    .min(1)
    .describe(
      "The comment, in Markdown. Write the question you want the reporter to answer, or the triage finding the next reader needs.",
    ),
  as: z
    .string()
    .min(1)
    .max(60)
    .describe(
      "Your own name as a client, e.g. `claude-code`. Optional; the comment is marked as agent-authored either way, so never sign the body.",
    )
    .optional(),
});

export const feedbackCommentAddResultSchema = feedbackCommentRefSchema;
