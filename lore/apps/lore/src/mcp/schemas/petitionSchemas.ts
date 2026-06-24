import { z } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

const petitionStatusSchema = z
  .enum(["pending", "accepted", "rejected"])
  .meta({ mode: "text" });

const petitionRefSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  tags: z.array(z.string()),
  status: petitionStatusSchema,
  reporterName: z.string().optional(),
  linkedQuestCount: z.integer(),
  createdAt: z.datetime(),
});

const petitionLinkedQuestRefSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  status: z.enum(["new", "accepted", "completed"]).meta({ mode: "text" }),
});

const petitionAttachmentRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
});

const petitionFullSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  status: petitionStatusSchema,
  reporterName: z.string().optional(),
  attachments: z.array(petitionAttachmentRefSchema),
  linkedQuests: z.array(petitionLinkedQuestRefSchema),
  createdAt: z.datetime(),
});

// -----------------------------------------------------------------------------
// petition_list
// -----------------------------------------------------------------------------

export const petitionListParamsSchema = campaignParamsSchema.extend({
  status: z
    .enum(["pending", "accepted", "rejected", "all"])
    .meta({ mode: "text" })
    .describe("Filter by status. Defaults to 'pending' (inbox triage).")
    .optional(),
});

export const petitionListResultSchema = z.object({
  petitions: z.array(petitionRefSchema),
});

// -----------------------------------------------------------------------------
// petition_get
// -----------------------------------------------------------------------------

export const petitionGetParamsSchema = campaignParamsSchema.extend({
  id: z
    .integer()
    .describe("Global petition ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-campaign 1-based shortId. Requires `campaign` or `campaign_name`.",
    )
    .optional(),
});

export const petitionGetResultSchema = petitionFullSchema;

// -----------------------------------------------------------------------------
// petition_attachment_get
// -----------------------------------------------------------------------------

export const petitionAttachmentGetParamsSchema = campaignParamsSchema.extend({
  id: z
    .integer()
    .describe("Global petition ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-campaign 1-based shortId. Requires `campaign` or `campaign_name`.",
    )
    .optional(),
  attachmentId: z
    .uuid()
    .describe(
      "Attachment id to fetch — one of the `attachments[].id` values returned by petition_get.",
    ),
});

// petition_attachment_get returns raw MCP content blocks (an `image` block for
// images, otherwise a `text` block), so it declares no `result` schema.

// -----------------------------------------------------------------------------
// petition_accept / petition_reject
// -----------------------------------------------------------------------------

export const petitionTriageParamsSchema = campaignParamsSchema.extend({
  id: z
    .integer()
    .describe("Global petition ID. Mutually exclusive with shortId.")
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-campaign 1-based shortId. Requires `campaign` or `campaign_name`.",
    )
    .optional(),
});

export const petitionTriageResultSchema = z.object({
  ok: z.boolean(),
});
