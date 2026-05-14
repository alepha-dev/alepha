import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
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
      "List all campaigns the user has access to (owned + adventurer-in). Use this to find the campaign id (required by most other tools) and check the title for campaign_name lookups. Each entry includes id, title, public (boolean), isOwner (boolean).",
    title: "List campaigns",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: t.object({}),
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
      "Get lightweight metadata about a campaign — zones, currently-active quests for the calling user, character stats. Call this before `quest_create` to see existing zones and reuse them with correct casing. For a richer orientation that also includes the folio index, prefer `campaign_context`.",
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
        character: result.character
          ? {
              xp: result.character.xp,
              balance: result.character.balance,
              owner: result.character.owner,
            }
          : undefined,
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
      "ORIENTATION TOOL — call FIRST on any campaign-scoped task. Returns campaign metadata, zones, the calling user's currently-active quests, and the folio index (titles + tags + updatedAt, NO content bodies). Folios are this campaign's memory for AI agents — read the index here, then call `folio_get` only on the ones that look relevant. ~2K tokens of complete situational awareness in one round-trip; the folio index is capped at 30 entries (sorted by updatedAt) — when `folios.capped` is true, use `folio_list` with a `tag` filter to fetch the rest.",
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
      // + character + active quests.
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
        }),
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
        character: result.character
          ? {
              xp: result.character.xp,
              balance: result.character.balance,
              owner: result.character.owner,
            }
          : undefined,
      };
    },
  });
}
