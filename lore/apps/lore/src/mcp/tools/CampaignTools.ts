import { $inject, Alepha, z } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { pinnedContentAtom } from "../../api/atoms/pinnedContentAtom.ts";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { foldPinnedFolios } from "../../api/services/PinnedFolioFolder.ts";
import {
  campaignContextParamsSchema,
  campaignContextResultSchema,
  campaignInfoParamsSchema,
  campaignInfoResultSchema,
  campaignListResultSchema,
} from "../schemas/index.ts";

/**
 * Folio index cap returned by `campaign_context`. Sized so a campaign with
 * 30 folios fits well under the ~2K token orientation budget; beyond this
 * the index would crowd out the quest signal. Agents follow the `capped`
 * flag and drill via `folio_list` when they need the long tail.
 */
const FOLIO_INDEX_CAP = 30;

/**
 * MCP tools for campaign operations.
 */
export class CampaignTools {
  protected readonly campaignController = $inject(CampaignController);
  protected readonly folioController = $inject(FolioController);
  protected readonly alepha = $inject(Alepha);

  /**
   * Resolve campaign ID from params (by ID or name).
   */
  protected async resolveCampaignId(
    campaign?: number,
    campaignName?: string,
  ): Promise<number> {
    const campaigns = await this.campaignController.getMyCampaigns();

    if (campaign) {
      const found = campaigns.find((p) => p.id === campaign);
      if (!found) {
        throw new NotFoundError(`Campaign with ID ${campaign} not found`);
      }
      return found.id;
    }

    if (campaignName) {
      const found = campaigns.find(
        (p) => p.title.toLowerCase() === campaignName.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Campaign "${campaignName}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Campaign is required. Specify campaign ID or campaign_name.",
    );
  }

  /**
   * List all campaigns (campaigns) the user has access to.
   */
  campaign_list = $tool({
    description:
      "List all campaigns the user has access to (owned + member-of). Use this to find the campaign id (required by most other tools) and check the title for campaign_name lookups. Each entry includes id, title, public (boolean), isOwner (boolean).",
    title: "List campaigns",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: z.object({}),
      result: campaignListResultSchema,
    },
    handler: async () => {
      const campaigns = await this.campaignController.getMyCampaigns();

      return {
        campaigns: campaigns.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public ?? false,
          isOwner: p.createdBy !== undefined, // Owner info from campaign
        })),
      };
    },
  });

  /**
   * Get campaign information.
   */
  campaign_info = $tool({
    description:
      "Get lightweight metadata about a campaign — zones, currently-active quests for the calling user, membership info. Call this before `quest_create` to see existing zones and reuse them with correct casing. For a richer orientation that also includes the folio index, prefer `campaign_context`.",
    title: "Campaign info",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: campaignInfoParamsSchema,
      result: campaignInfoResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const result = await this.campaignController.getCampaignById({
        params: { id: campaignId },
      });

      return {
        id: result.id,
        title: result.title,
        public: result.public ?? false,
        zones: result.zones,
        createdAt: result.createdAt,
        activeQuests: result.quests.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          zone: quest.zone,
          priority: quest.priority,
          difficulty: quest.difficulty,
        })),
        isOwner: result.member?.owner ?? false,
      };
    },
  });

  /**
   * One-shot orientation tool. Returns campaign metadata + active quests +
   * the folio index in a single ~2K-token payload. Designed as the FIRST
   * call any agent makes when picking up a campaign-scoped task — folios
   * act as the campaign's memory for Claude (see apps/lore/CLAUDE.md).
   */
  campaign_context = $tool({
    description:
      "ORIENTATION TOOL — call FIRST on any campaign-scoped task. Returns campaign metadata, zones, the calling user's currently-active quests, the folio index (titles + tags + updatedAt, NO content bodies), AND the full content of any pinned folios (the per-campaign CLAUDE.md / AGENTS.md — read these first, they're the campaign rules). Folios are this campaign's shared memory for AI agents — read the index here, then call `folio_get` only on the ones that look relevant. ~2K tokens of complete situational awareness in one round-trip; the folio index is capped at 30 entries (sorted by pinned DESC, updatedAt DESC) — when `folios.capped` is true, use `folio_list` with a `tag` filter to fetch the rest. Pinned-folio total content is capped at ~8K chars; when `pinnedFoliosTruncated` is true some pinned bodies were dropped — `folio_get` them by id. When `preferredLanguage` is set (ISO 639-1 — e.g. `fr`, `ja`), generated content (quest titles, descriptions, folio bodies) MUST be written in that language unless the user explicitly asks for another.",
    title: "Campaign context (orientation)",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: campaignContextParamsSchema,
      result: campaignContextResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      // Reuse `getCampaignById` so quest scoping (acceptedBy === user) and
      // membership checks stay in one place. One round-trip for the campaign
      // + membership + active quests.
      const result = await this.campaignController.getCampaignById({
        params: { id: campaignId },
      });

      // Fetch one over the cap to detect truncation without a separate count
      // query — cheap on D1 (single LIKE-free indexed range scan).
      const folios = await this.folioController.list({
        query: {
          campaignId,
          limit: FOLIO_INDEX_CAP + 1,
        },
      });
      const capped = folios.length > FOLIO_INDEX_CAP;
      const items = (capped ? folios.slice(0, FOLIO_INDEX_CAP) : folios).map(
        (folio) => ({
          shortId: folio.shortId,
          title: folio.title,
          tags: folio.tags ?? [],
          updatedAt: folio.updatedAt,
          // Omit when empty so agents seeing the field always trust it.
          // The schema field is optional; consumers fall back to title.
          summary: folio.summary?.trim() ? folio.summary : undefined,
        }),
      );

      // Pinned-folio content surface (the per-campaign CLAUDE.md). Drop
      // protected folios — their content is ciphertext and useless to
      // the agent. Cap logic lives in `foldPinnedFolios` so it can be
      // unit-tested without spinning the MCP transport.
      const cap = this.alepha.store.get(pinnedContentAtom).maxChars;
      const { pinnedFolios, pinnedFoliosTruncated } = foldPinnedFolios(
        folios
          .filter((f) => f.pinned && !f.protected)
          // controller already sorts (pinned DESC, updatedAt DESC) so
          // this slice is already newest-first.
          .map((f) => ({
            id: f.id,
            shortId: f.shortId,
            title: f.title,
            content: f.content,
          })),
        cap,
      );

      return {
        id: result.id,
        title: result.title,
        public: result.public ?? false,
        zones: result.zones,
        createdAt: result.createdAt,
        activeQuests: result.quests.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          zone: quest.zone,
          priority: quest.priority,
          difficulty: quest.difficulty,
        })),
        folios: {
          shown: items.length,
          capped,
          items,
        },
        pinnedFolios,
        pinnedFoliosTruncated,
        isOwner: result.member?.owner ?? false,
      };
    },
  });
}
