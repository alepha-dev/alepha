import { t } from "alepha";
import { campaignParamsSchema } from "./commonSchemas.ts";

const petitionStatusSchema = t.enum(["pending", "accepted", "rejected"], {
  mode: "text",
});

const petitionReportTypeSchema = t.enum(["bug", "feature"], { mode: "text" });

const petitionRefSchema = t.object({
  id: t.integer(),
  title: t.string(),
  reportType: petitionReportTypeSchema,
  status: petitionStatusSchema,
  reporterName: t.optional(t.string()),
  linkedQuestCount: t.integer(),
  createdAt: t.datetime(),
});

const petitionLinkedQuestRefSchema = t.object({
  id: t.integer(),
  title: t.string(),
  status: t.enum(["new", "accepted", "completed"], { mode: "text" }),
});

const petitionFullSchema = t.object({
  id: t.integer(),
  title: t.string(),
  description: t.string(),
  reportType: petitionReportTypeSchema,
  status: petitionStatusSchema,
  reporterName: t.optional(t.string()),
  context: t.optional(
    t.object({
      url: t.optional(t.string()),
      path: t.optional(t.string()),
    }),
  ),
  attachmentCount: t.integer(),
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
  id: t.integer({ description: "Petition ID" }),
});

export const petitionGetResultSchema = petitionFullSchema;

// -----------------------------------------------------------------------------
// petition_accept / petition_reject
// -----------------------------------------------------------------------------

export const petitionTriageParamsSchema = t.extend(campaignParamsSchema, {
  id: t.integer({ description: "Petition ID" }),
});

export const petitionTriageResultSchema = t.object({
  ok: t.boolean(),
});
