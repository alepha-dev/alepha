import { z } from "alepha";
import { questStatusSchema } from "../../api/schemas/questResourceSchema.ts";

/**
 * Quest priority levels.
 */
export const prioritySchema = z.enum(["optional", "low", "medium", "high"]);

export { questStatusSchema };

/**
 * Quest objective.
 */
export const objectiveSchema = z.object({
  title: z.string(),
  completed: z.boolean(),
});

/**
 * Common campaign identification params for MCP tools.
 * Either campaign ID or campaign_name must be provided. If both are passed,
 * `campaign` (the ID) wins.
 */
export const campaignParamsSchema = z.object({
  campaign: z
    .integer()
    .describe(
      "Campaign ID. Required if campaign_name is not provided. Takes precedence if both are provided.",
    )
    .optional(),
  campaign_name: z
    .string()
    .describe(
      "Campaign name (campaign title). Case-insensitive. Required if campaign is not provided. Ignored when campaign is also provided.",
    )
    .optional(),
});

/**
 * Entity reference for MCP tools. Tools accept EITHER:
 *   - `id` — the global, stable identifier (preferred for agents that
 *     persist references across sessions; immune to entity transfer).
 *   - `shortId` — the per-campaign 1-based id shown in URLs and UI
 *     ("#12"). When using `shortId`, the campaign context must be
 *     resolvable via `campaign` or `campaign_name`.
 *
 * Exactly one of `id` or `shortId` must be provided.
 */
export const entityRefSchema = z.object({
  id: z
    .integer()
    .describe(
      "Global entity ID (stable across sessions/campaigns). Mutually exclusive with shortId.",
    )
    .optional(),
  shortId: z
    .integer()
    .describe(
      "Per-campaign 1-based shortId (the '#12' you see in URLs and UI). Requires `campaign` or `campaign_name` to disambiguate.",
    )
    .optional(),
  campaign: z
    .integer()
    .describe("Campaign ID — required when using `shortId`.")
    .optional(),
  campaign_name: z
    .string()
    .describe(
      "Campaign name (case-insensitive) — required when using `shortId` if `campaign` not provided.",
    )
    .optional(),
});
