import { z } from "alepha";
import { campaignParamsSchema, prioritySchema } from "./commonSchemas.ts";

// -----------------------------------------------------------------------------
// Shared sub-schemas
// -----------------------------------------------------------------------------

/**
 * Quest reference for orientation tools (campaign_info / campaign_context).
 * Carries enough for the agent to decide whether to drill down with
 * `quest_get`, but not the description body or objectives.
 */
const questOrientationRefSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  zone: z.string(),
  priority: prioritySchema,
  difficulty: z.integer(),
});

// -----------------------------------------------------------------------------
// campaign_list
// -----------------------------------------------------------------------------

export const campaignListResultSchema = z.object({
  campaigns: z.array(
    z.object({
      id: z.integer(),
      title: z.string(),
      public: z.boolean(),
      isOwner: z.boolean(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// campaign_info
// -----------------------------------------------------------------------------

export const campaignInfoParamsSchema = campaignParamsSchema;

export const campaignInfoResultSchema = z.object({
  id: z.integer(),
  title: z.string(),
  public: z.boolean(),
  zones: z.array(z.string()),
  createdAt: z.datetime(),
  activeQuests: z.array(questOrientationRefSchema),
  /**
   * `true` when the calling user owns (created) this campaign.
   */
  isOwner: z.boolean(),
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
const folioIndexEntrySchema = z.object({
  shortId: z.integer(),
  title: z.string(),
  tags: z.array(z.string()),
  updatedAt: z.string(),
  summary: z.string().optional(),
});

export const campaignContextResultSchema = z.object({
  id: z.integer(),
  title: z.string(),
  public: z.boolean(),
  zones: z.array(z.string()),
  createdAt: z.datetime(),
  /**
   * Quests the calling user has accepted and not yet completed. Matches the
   * `campaign_info` semantic — "what is the user currently working on" — so
   * agents pick up the same signal humans see in the campaign board.
   */
  activeQuests: z.array(questOrientationRefSchema),
  /**
   * The calling user's folios in this campaign, newest-updated first. Bodies
   * are intentionally omitted — call `folio_get` only after deciding what's
   * relevant from this index.
   */
  folios: z.object({
    /** Number of entries returned (≤ 30). */
    shown: z.integer(),
    /**
     * `true` if the index was capped at the limit — the agent should call
     * `folio_list` (optionally with a `tag` filter) to see the rest.
     */
    capped: z.boolean(),
    items: z.array(folioIndexEntrySchema),
  }),
  /**
   * Full content of pinned folios — the campaign's CLAUDE.md / AGENTS.md
   * equivalent. Returned in `(pinned DESC, updatedAt DESC)` order; the
   * sum of `content` lengths is capped (see `pinnedFoliosTruncated`).
   * Protected (encrypted) folios are excluded since their content is
   * opaque ciphertext.
   */
  pinnedFolios: z.array(
    z.object({
      id: z.uuid(),
      shortId: z.integer(),
      title: z.string(),
      content: z.string(),
      /**
       * When set, the folio's content exceeded the per-call cap and was
       * truncated to this many characters. Renderers may show a
       * "truncated" badge so the agent knows to `folio_get` for the rest.
       */
      truncatedAt: z.integer().optional(),
    }),
  ),
  /**
   * `true` if the total pinned content exceeded the cap and at least one
   * pinned folio was dropped from the response. The agent can fall back
   * to `folio_get` on the dropped ones, or the user can unpin some.
   */
  pinnedFoliosTruncated: z.boolean(),
  /**
   * `true` when the calling user owns (created) this campaign.
   */
  isOwner: z.boolean(),
  /**
   * ISO 639-1 code (e.g. "fr", "ja") the owner picked as the preferred
   * language for AI-generated content. When set, agents should write
   * quest titles, descriptions and folio bodies in this language
   * unless the user explicitly asks for another. Absent = no
   * preference; fall back to the conversation language.
   */
  preferredLanguage: z.string().optional(),
});
