import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { ChapterController } from "../../api/controllers/ChapterController.ts";
import {
  chapterChangelogParamsSchema,
  chapterChangelogResultSchema,
  chapterCloseParamsSchema,
  chapterCloseResultSchema,
  chapterListParamsSchema,
  chapterListResultSchema,
  chapterStartParamsSchema,
  chapterStartResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for chapter operations.
 */
export class ChapterTools {
  protected readonly chapterController = $inject(ChapterController);
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
   * Resolve a chapter reference (`id` or `number` + campaign) to the global
   * chapter id.
   */
  protected async resolveChapterId(params: {
    id?: number;
    number?: number;
    campaign?: number;
    campaign_name?: string;
  }): Promise<number> {
    if (params.id != null) return params.id;
    if (params.number != null) {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const result = await this.chapterController.getChapters({
        params: { campaignId },
      });
      const found = result.find((ch) => ch.number === params.number);
      if (!found) {
        throw new NotFoundError(
          `Chapter ${params.number} not found in campaign`,
        );
      }
      return found.id;
    }
    throw new BadRequestError(
      "Chapter reference required: pass `id` (global) or `number` (per-campaign — also requires `campaign` or `campaign_name`).",
    );
  }

  /**
   * List all chapters for a campaign.
   */
  chapter_list = $tool({
    description:
      "List all chapters for a campaign, both active (open) and closed. Chapters are iterative milestones that capture completed quests. Sorted by chapter number ascending. Each entry includes id, number, title, description, questCount, createdAt, and closedAt (undefined for the active chapter).",
    title: "List chapters",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: chapterListParamsSchema,
      result: chapterListResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const result = await this.chapterController.getChapters({
        params: { campaignId },
      });

      return {
        chapters: result.map((ch) => ({
          id: ch.id,
          number: ch.number,
          title: ch.title,
          description: ch.description,
          questCount: ch.questCount,
          closedAt: ch.closedAt,
          createdAt: ch.createdAt,
        })),
      };
    },
  });

  /**
   * Start a new chapter.
   */
  chapter_start = $tool({
    description:
      "Start a new chapter for a campaign. Only one chapter can be active at a time. Quests completed while a chapter is active are automatically attached to it.",
    title: "Start chapter",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: chapterStartParamsSchema,
      result: chapterStartResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const chapter = await this.chapterController.startChapter({
        params: { campaignId },
        body: {
          title: params.title,
          description: params.description,
        },
      });

      return {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        createdAt: chapter.createdAt,
      };
    },
  });

  /**
   * Close an active chapter.
   */
  chapter_close = $tool({
    description:
      "Close an active chapter. No more quests will be attached to it after closing.",
    title: "Close chapter",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: chapterCloseParamsSchema,
      result: chapterCloseResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveChapterId(params);
      const chapter = await this.chapterController.closeChapter({
        params: { id },
        body: { title: params.title },
      });

      return {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        closedAt: chapter.closedAt!,
      };
    },
  });

  /**
   * Get changelog for a chapter.
   */
  chapter_changelog = $tool({
    description:
      "Generate a Markdown changelog for a chapter, listing all completed quests grouped by zone.",
    title: "Chapter changelog",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: chapterChangelogParamsSchema,
      result: chapterChangelogResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveChapterId(params);
      const result = await this.chapterController.getChapterChangelog({
        params: { id },
      });

      return {
        markdown: result.markdown,
        stats: result.stats,
      };
    },
  });
}
