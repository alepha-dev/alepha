import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import {
  campaignInfoParamsSchema,
  campaignInfoResultSchema,
  campaignListResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for campaign operations.
 */
export class CampaignTools {
  protected readonly campaignController = $inject(CampaignController);

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
      "List all campaigns (campaigns) the user has access to. Use this to find available campaigns before querying quests.",
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
      "Get information about a campaign, including zones/zones and active quests.",
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
}
