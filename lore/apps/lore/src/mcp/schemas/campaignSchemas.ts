import { t } from "alepha";
import { campaignParamsSchema, prioritySchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// campaign_list
// -----------------------------------------------------------------------------

export const campaignListResultSchema = t.object({
  campaigns: t.array(
    t.object({
      id: t.integer(),
      title: t.string(),
      public: t.boolean(),
      isOwner: t.boolean(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// campaign_info
// -----------------------------------------------------------------------------

export const campaignInfoParamsSchema = campaignParamsSchema;

export const campaignInfoResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  public: t.boolean(),
  zones: t.array(t.string()),
  createdAt: t.datetime(),
  activeQuests: t.array(
    t.object({
      id: t.integer(),
      title: t.string(),
      zone: t.string(),
      priority: prioritySchema,
      difficulty: t.integer(),
    }),
  ),
  character: t.optional(
    t.object({
      xp: t.integer(),
      balance: t.integer(),
      owner: t.boolean(),
    }),
  ),
});
