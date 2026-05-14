import { t } from "alepha";
import { campaignParamsSchema, prioritySchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// Shared sub-schemas
// -----------------------------------------------------------------------------

/**
 * Quest reference for orientation tools (campaign_info / campaign_context).
 * Carries enough for the agent to decide whether to drill down with
 * `quest_get`, but not the description body or objectives.
 */
const questOrientationRefSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  zone: t.string(),
  priority: prioritySchema,
  difficulty: t.integer(),
});

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
  activeQuests: t.array(questOrientationRefSchema),
  character: t.optional(
    t.object({
      xp: t.integer(),
      balance: t.integer(),
      owner: t.boolean(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// campaign_context
//
// One-shot orientation tool: returns everything an AI agent needs to
// situate itself in a campaign without follow-up `folio_list` / `quest_get`
// round-trips. Bounded to ~2K tokens.
// -----------------------------------------------------------------------------

export const campaignContextParamsSchema = campaignParamsSchema;

/**
 * Folio entry in the orientation index.
 *
 * - `id` (uuid) is intentionally omitted to save tokens — agents reference
 *   folios by `shortId` + campaign for any follow-up call.
 * - `summary` is reserved for Phase 3 of the "Folios as Claude's memory"
 *   feature; until that lands the field stays optional and unset.
 */
const folioIndexEntrySchema = t.object({
  shortId: t.integer(),
  title: t.string(),
  tags: t.array(t.string()),
  updatedAt: t.string(),
  summary: t.optional(t.string()),
});

export const campaignContextResultSchema = t.object({
  id: t.integer(),
  title: t.string(),
  public: t.boolean(),
  zones: t.array(t.string()),
  createdAt: t.datetime(),
  /**
   * Quests the calling user has accepted and not yet completed. Matches the
   * `campaign_info` semantic — "what is the user currently working on" — so
   * agents pick up the same signal humans see in the campaign board.
   */
  activeQuests: t.array(questOrientationRefSchema),
  /**
   * The calling user's folios in this campaign, newest-updated first. Bodies
   * are intentionally omitted — call `folio_get` only after deciding what's
   * relevant from this index.
   */
  folios: t.object({
    /** Number of entries returned (≤ 30). */
    shown: t.integer(),
    /**
     * `true` if the index was capped at the limit — the agent should call
     * `folio_list` (optionally with a `tag` filter) to see the rest.
     */
    capped: t.boolean(),
    items: t.array(folioIndexEntrySchema),
  }),
  /**
   * Calling user's character in this campaign (XP, gold/silver balance,
   * owner flag). Omitted on public campaigns where the caller has no
   * character yet.
   */
  character: t.optional(
    t.object({
      xp: t.integer(),
      balance: t.integer(),
      owner: t.boolean(),
    }),
  ),
});
