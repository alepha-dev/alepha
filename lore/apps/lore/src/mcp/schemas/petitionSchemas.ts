import { t } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

const petitionStatusSchema = t.enum(["pending", "accepted", "rejected"], {
  mode: "text",
});

const petitionRefSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  tags: t.array(t.string()),
  status: petitionStatusSchema,
  reporterName: t.optional(t.string()),
  linkedQuestCount: t.integer(),
  createdAt: t.datetime(),
});

const petitionLinkedQuestRefSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  status: t.enum(["new", "accepted", "completed"], { mode: "text" }),
});

const petitionAttachmentRefSchema = t.object({
  id: t.uuid(),
  name: t.string(),
  mimeType: t.string(),
  size: t.number(),
});

const petitionFullSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  description: t.string(),
  tags: t.array(t.string()),
  status: petitionStatusSchema,
  reporterName: t.optional(t.string()),
  attachments: t.array(petitionAttachmentRefSchema),
  linkedQuests: t.array(petitionLinkedQuestRefSchema),
  createdAt: t.datetime(),
});

// -----------------------------------------------------------------------------
// petition_list
// -----------------------------------------------------------------------------

export const petitionListParamsSchema = t.extend(campaignParamsSchema, {
  status: t.optional(
    t.enum(["pending", "accepted", "rejected", "all"], {
      mode: "text",
      description: "Filter by status. Defaults to 'pending' (inbox triage).",
    }),
  ),
});

export const petitionListResultSchema = t.object({
  petitions: t.array(petitionRefSchema),
});

// -----------------------------------------------------------------------------
// petition_get
// -----------------------------------------------------------------------------

export const petitionGetParamsSchema = t.extend(campaignParamsSchema, {
  id: t.optional(
    t.integer({
      description: "Global petition ID. Mutually exclusive with shortId.",
    }),
  ),
  shortId: t.optional(
    t.integer({
      description:
        "Per-campaign 1-based shortId. Requires `campaign` or `campaign_name`.",
    }),
  ),
});

export const petitionGetResultSchema = petitionFullSchema;

// -----------------------------------------------------------------------------
// petition_attachment_get
// -----------------------------------------------------------------------------

export const petitionAttachmentGetParamsSchema = t.extend(
  campaignParamsSchema,
  {
    id: t.optional(
      t.integer({
        description: "Global petition ID. Mutually exclusive with shortId.",
      }),
    ),
    shortId: t.optional(
      t.integer({
        description:
          "Per-campaign 1-based shortId. Requires `campaign` or `campaign_name`.",
      }),
    ),
    attachmentId: t.uuid({
      description:
        "Attachment id to fetch — one of the `attachments[].id` values returned by petition_get.",
    }),
  },
);

// petition_attachment_get returns raw MCP content blocks (an `image` block for
// images, otherwise a `text` block), so it declares no `result` schema.

// -----------------------------------------------------------------------------
// petition_accept / petition_reject
// -----------------------------------------------------------------------------

export const petitionTriageParamsSchema = t.extend(campaignParamsSchema, {
  id: t.optional(
    t.integer({
      description: "Global petition ID. Mutually exclusive with shortId.",
    }),
  ),
  shortId: t.optional(
    t.integer({
      description:
        "Per-campaign 1-based shortId. Requires `campaign` or `campaign_name`.",
    }),
  ),
});

export const petitionTriageResultSchema = t.object({
  ok: t.boolean(),
});
