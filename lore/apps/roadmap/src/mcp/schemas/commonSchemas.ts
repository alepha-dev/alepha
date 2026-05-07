import { t } from "alepha";
import { questStatusSchema } from "../../api/schemas/questResourceSchema.ts";

/**
 * Quest priority levels.
 */
export const prioritySchema = t.enum(["optional", "low", "medium", "high"]);

export { questStatusSchema };

/**
 * Quest objective.
 */
export const objectiveSchema = t.object({
  title: t.string(),
  completed: t.boolean(),
});

/**
 * Common campaign identification params for MCP tools.
 * Either campaign ID or campaign_name must be provided.
 */
export const campaignParamsSchema = t.object({
  campaign: t.optional(
    t.integer({
      description: "Campaign ID. Required if campaign_name is not provided.",
    }),
  ),
  campaign_name: t.optional(
    t.string({
      description:
        "Campaign name (campaign title). Case-insensitive. Required if campaign is not provided.",
    }),
  ),
});
