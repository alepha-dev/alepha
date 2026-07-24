import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { PetitionController } from "../../api/controllers/PetitionController.ts";
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
  questTagsParamsSchema,
  questTagsResultSchema,
  questUpdateParamsSchema,
  questUpdateResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for quest operations.
 */
export class QuestTools {
  protected readonly questController = $inject(QuestController);
  protected readonly campaignController = $inject(CampaignController);
  protected readonly petitionController = $inject(PetitionController);

  /**
   * Resolve a per-campaign petition `shortId` to its global petition id, so a
   * quest can be linked to it. Throws if no petition in the campaign carries
   * that shortId.
   */
  protected async resolvePetitionId(
    campaignId: number,
    shortId: number,
  ): Promise<number> {
    const result = await this.petitionController.listPetitions({
      params: { campaignId },
      query: { status: "all" },
    });
    const found = result.items.find((p) => p.shortId === shortId);
    if (!found) {
      throw new NotFoundError(
        `Petition with shortId ${shortId} not found in this campaign`,
      );
    }
    return found.id;
  }

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
      "List quests for the campaign. Can filter by status (new, accepted, completed), search by title, or filter by a single tag (use `quest_tags` to discover existing tag values).",
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
          tag: params.tag,
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
          tags: quest.tags,
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
    description:
      "Create a new quest in the campaign. Pass `accept: true` to also accept it (assign it to yourself) in the same call — skips a separate quest_accept round-trip.",
    title: "Create quest",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: questCreateParamsSchema,
      result: questCreateResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      // Resolve `dependsOn_shortId` → global quest id (same campaign).
      let dependsOn: number | undefined;
      if (params.dependsOn_shortId != null) {
        const pred = await this.questController.getQuestByShortId({
          params: { campaignId, shortId: params.dependsOn_shortId },
        });
        dependsOn = pred.id;
      }
      // Resolve `petition_shortId` → global petition id (same campaign).
      let petitionId: number | undefined;
      if (params.petition_shortId != null) {
        petitionId = await this.resolvePetitionId(
          campaignId,
          params.petition_shortId,
        );
      }
      const quest = await this.questController.createQuest({
        body: {
          campaignId,
          title: params.title,
          description: params.description,
          zone: params.zone,
          priority: params.priority,
          difficulty: params.difficulty,
          objectives: params.objectives,
          tags: params.tags,
          dependsOn,
          petitionId,
        },
      });

      // `accept: true` mirrors the UI's "Create and accept" split button:
      // chain an accept onto the create so an agent about to work the quest
      // skips a second quest_accept round-trip. Best-effort and non-atomic
      // (same as the UI, which fires two sequential calls): if the accept is
      // refused — the only realistic case on a brand-new quest is a
      // questline gate, i.e. `dependsOn` points at an incomplete predecessor
      // — the quest stays created and we surface the reason in `acceptNote`
      // instead of failing the whole tool call.
      let acceptedAt: string | undefined;
      let acceptNote: string | undefined;
      if (params.accept) {
        try {
          const accepted = await this.questController.acceptQuest({
            params: { id: quest.id },
          });
          acceptedAt = accepted.acceptedAt;
        } catch (error) {
          acceptNote =
            error instanceof Error
              ? error.message
              : "Quest created, but it could not be accepted.";
        }
      }

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        createdAt: quest.createdAt,
        acceptedAt,
        acceptNote,
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
    annotations: { readOnlyHint: false, idempotentHint: true },
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
      "Mark a quest as complete. All objectives must be completed first. Pass `message` with a short summary of what was actually done — the summary is persisted on the quest, shown in the UI, and returned by `quest_get` / `campaign_context` so future agents working on this campaign can read it. Leaving it blank is allowed but wastes a free way to hand context to the next session.",
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
        body: { message: params.message },
      });

      return {
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        completedAt: result.completedAt!,
        // Per-completion award, computed server-side. Reading
        // `character.xp` / `.balance` here would report the character's
        // lifetime totals as this quest's reward.
        xpEarned: result.xpEarned,
        moneyEarned: result.moneyEarned,
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

      let dependsOn_shortId: number | undefined;
      if (quest.dependsOn != null) {
        const pred = await this.questController.getQuestById({
          params: { id: quest.dependsOn },
        });
        dependsOn_shortId = pred.shortId;
      }

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
        completionMessage: quest.completionMessage,
        completionMessageUpdatedAt: quest.completionMessageUpdatedAt,
        tags: quest.tags,
        dependsOn_shortId,
      };
    },
  });

  /**
   * List the distinct set of tags used by any quest in a campaign — fuel
   * for autocomplete and dedup. Mirrors `folio_tags`.
   */
  quest_tags = $tool({
    description:
      "List every tag used by any quest in the campaign. Call before `quest_create` / `quest_update` so you reuse existing tags (`bug`, `feat`, `chore`, …) instead of inventing slight variants like `Bug` / `bugs`.",
    title: "List quest tags",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: questTagsParamsSchema,
      result: questTagsResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const tags = await this.questController.listQuestTags({
        query: { campaignId },
      });
      return { tags };
    },
  });

  /**
   * Update a quest.
   */
  quest_update = $tool({
    description:
      "Update a quest's properties. Non-completed quests accept any field; completed quests only accept `completionMessage` (campaign memory stays curatable, but the quest body is frozen as an audit record). Omitted fields stay unchanged. Note: passing `objectives` REPLACES the entire objectives array — fetch the current quest first (quest_get or quest_list) and pass back the full list with your edits.",
    title: "Update quest",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: questUpdateParamsSchema,
      result: questUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      // `dependsOn_shortId` / `petition_shortId` both resolve against the
      // quest's OWN campaign; fetch it once if either is supplied.
      const needsCampaign =
        (params.dependsOn_shortId != null && params.dependsOn_shortId !== 0) ||
        (params.petition_shortId != null && params.petition_shortId !== 0);
      const current = needsCampaign
        ? await this.questController.getQuestById({ params: { id } })
        : undefined;

      // Translate `dependsOn_shortId` for update: 0 = clear, integer =
      // resolve to global id within the same campaign as the quest.
      let dependsOn: number | null | undefined;
      if (params.dependsOn_shortId === 0) {
        dependsOn = null;
      } else if (params.dependsOn_shortId != null && current) {
        const pred = await this.questController.getQuestByShortId({
          params: {
            campaignId: current.campaignId,
            shortId: params.dependsOn_shortId,
          },
        });
        dependsOn = pred.id;
      }

      // Translate `petition_shortId`: 0 = unlink, integer = resolve to the
      // petition's global id within the quest's campaign.
      let petitionId: number | null | undefined;
      if (params.petition_shortId === 0) {
        petitionId = null;
      } else if (params.petition_shortId != null && current) {
        petitionId = await this.resolvePetitionId(
          current.campaignId,
          params.petition_shortId,
        );
      }

      const quest = await this.questController.updateQuestById({
        params: { id },
        body: {
          title: params.title,
          description: params.description,
          zone: params.zone,
          priority: params.priority,
          difficulty: params.difficulty,
          objectives: params.objectives,
          completionMessage: params.completionMessage,
          tags: params.tags,
          dependsOn,
          petitionId,
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
