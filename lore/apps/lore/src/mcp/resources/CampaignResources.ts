import { $inject } from "alepha";
import { $resource } from "alepha/mcp";
import { CampaignController } from "../../api/controllers/CampaignController.ts";

/**
 * MCP resources for campaign data.
 *
 * These resources expose read-only campaign information to LLM clients
 * through the MCP protocol.
 *
 * Note: Use campaign_list tool first to get available campaigns,
 * then use campaign_info and quest_list tools for campaign-specific data.
 */
export class CampaignResources {
  protected readonly campaignController = $inject(CampaignController);

  /**
   * List of all campaigns the user has access to.
   */
  campaignList = $resource({
    uri: "lore://campaigns",
    name: "Campaign List",
    description:
      "List of all campaigns (campaigns) the user has access to. Use campaign_list tool for more details, or use campaign ID/title in other tools.",
    mimeType: "application/json",
    handler: async () => {
      const campaigns = await this.campaignController.getMyCampaigns();

      const data = {
        campaigns: campaigns.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public ?? false,
        })),
        hint: "Use campaign ID or title (campaign_name) in tools like quest_list, campaign_info to access campaign data.",
      };

      return {
        text: JSON.stringify(data, null, 2),
      };
    },
  });
}
