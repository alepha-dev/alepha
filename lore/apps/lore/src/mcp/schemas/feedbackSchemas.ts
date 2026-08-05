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
