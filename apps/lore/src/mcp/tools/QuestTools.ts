import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { QuestController } from "../../api/controllers/QuestController.ts";
import {
  questAcceptParamsSchema,
  questAcceptResultSchema,
  questCompleteParamsSchema,
  questCompleteResultSchema,
  questCreateParamsSchema,
  questCreateResultSchema,
  questDeleteParamsSchema,
  questDeleteResultSchema,
  questGetParamsSchema,
  questGetResultSchema,
  questListParamsSchema,
  questListResultSchema,
  questUpdateParamsSchema,
  questUpdateResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for quest operations.
 */
export class QuestTools {
  protected readonly questController = $inject(QuestController);
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
   * Get quest status from quest data.
   */
  protected getQuestStatus(quest: {
    acceptedAt?: string;
    completedAt?: string;
  }): "new" | "accepted" | "completed" {
    if (quest.completedAt) return "completed";
    if (quest.acceptedAt) return "accepted";
    return "new";
  }

  /**
   * Accept either a global `id` or a per-campaign `shortId` reference
   * (with `campaign` / `campaign_name`) and return the global quest id.
   */
  protected async resolveQuestId(params: {
    id?: number;
    shortId?: number;
    campaign?: number;
    campaign_name?: string;
  }): Promise<number> {
    if (params.id != null) return params.id;
    if (params.shortId != null) {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const quest = await this.questController.getQuestByShortId({
        params: { campaignId, shortId: params.shortId },
      });
      return quest.id;
    }
    throw new BadRequestError(
      "Quest reference required: pass `id` (global) or `shortId` (per-campaign — also requires `campaign` or `campaign_name`).",
    );
  }

  /**
   * List quests for a campaign.
   */
  quest_list = $tool({
    description:
      "List quests for the campaign. Can filter by status (new, accepted, completed) and search by title.",
    title: "List quests",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: questListParamsSchema,
      result: questListResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const size = params.limit ?? 20;
      const page = params.offset ? Math.floor(params.offset / size) : 0;

      const result = await this.questController.getQuests({
        params: { campaignId },
        query: {
          status: params.status,
          search: params.search,
          size,
          page,
        },
      });

      return {
        quests: result.content.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          description: quest.description,
          zone: quest.zone,
          priority: quest.priority,
          difficulty: quest.difficulty,
          status: this.getQuestStatus(quest),
          objectives: quest.objectives,
          createdAt: quest.createdAt,
          acceptedAt: quest.acceptedAt,
          completedAt: quest.completedAt,
        })),
        total: result.page.totalElements ?? 0,
        hasMore: !result.page.isLast,
      };
    },
  });

  /**
   * Create a new quest.
   */
  quest_create = $tool({
    description: "Create a new quest in the campaign.",
    title: "Create quest",
    schema: {
      params: questCreateParamsSchema,
      result: questCreateResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const quest = await this.questController.createQuest({
        body: {
          campaignId,
          title: params.title,
          description: params.description,
          zone: params.zone,
          priority: params.priority,
          difficulty: params.difficulty,
          objectives: params.objectives,
        },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        createdAt: quest.createdAt,
      };
    },
  });

  /**
   * Accept a quest (assign it to yourself).
   */
  quest_accept = $tool({
    description:
      "Accept a quest to start working on it. This assigns the quest to you.",
    title: "Accept quest",
    annotations: { idempotentHint: true },
    schema: {
      params: questAcceptParamsSchema,
      result: questAcceptResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.acceptQuest({
        params: { id },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        acceptedAt: quest.acceptedAt!,
      };
    },
  });

  /**
   * Complete a quest.
   */
  quest_complete = $tool({
    description:
      "Mark a quest as complete. All objectives must be completed first.",
    title: "Complete quest",
    annotations: {
      // destructive: state-altering, awards XP and gold; cannot be undone
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: questCompleteParamsSchema,
      result: questCompleteResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const result = await this.questController.completeQuest({
        params: { id },
      });

      // Calculate rewards from character delta
      const xpEarned = result.character?.xp;
      const moneyEarned = result.character?.balance;

      return {
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        completedAt: result.completedAt!,
        xpEarned,
        moneyEarned,
      };
    },
  });

  /**
   * Get a single quest by ID.
   */
  quest_get = $tool({
    description:
      "Fetch a single quest by ID, including its current objectives, description, status, and timestamps. Use this before quest_update to see current state.",
    title: "Get quest",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: questGetParamsSchema,
      result: questGetResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.getQuestById({
        params: { id },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        description: quest.description,
        zone: quest.zone,
        priority: quest.priority,
        difficulty: quest.difficulty,
        status: this.getQuestStatus(quest),
        objectives: quest.objectives,
        campaignId: quest.campaignId,
        chapterId: quest.chapterId,
        createdAt: quest.createdAt,
        updatedAt: quest.updatedAt,
        acceptedAt: quest.acceptedAt,
        completedAt: quest.completedAt,
      };
    },
  });

  /**
   * Update a quest.
   */
  quest_update = $tool({
    description:
      "Update a quest's properties. Only non-completed quests can be updated. Omitted fields stay unchanged. Note: passing `objectives` REPLACES the entire objectives array — fetch the current quest first (quest_get or quest_list) and pass back the full list with your edits.",
    title: "Update quest",
    annotations: { idempotentHint: true },
    schema: {
      params: questUpdateParamsSchema,
      result: questUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.updateQuestById({
        params: { id },
        body: {
          title: params.title,
          description: params.description,
          zone: params.zone,
          priority: params.priority,
          difficulty: params.difficulty,
          objectives: params.objectives,
        },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        updatedAt: quest.updatedAt,
      };
    },
  });

  /**
   * Delete a quest.
   */
  quest_delete = $tool({
    description:
      "Permanently delete a quest. Use this to clean up mistakenly-created quests. Only the quest creator or campaign owner can delete. Cannot be undone.",
    title: "Delete quest",
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: questDeleteParamsSchema,
      result: questDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      await this.questController.deleteQuest({
        params: { id },
      });
      return { ok: true };
    },
  });
}
