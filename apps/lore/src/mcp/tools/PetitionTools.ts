import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { CampaignController } from "../../api/controllers/CampaignController.ts";
import { PetitionController } from "../../api/controllers/PetitionController.ts";
import type { PetitionResource } from "../../api/schemas/petitionResourceSchema.ts";
import {
  petitionAttachmentGetParamsSchema,
  petitionGetParamsSchema,
  petitionGetResultSchema,
  petitionListParamsSchema,
  petitionListResultSchema,
  petitionTriageParamsSchema,
  petitionTriageResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for petitions — user-submitted bug/feature requests that the
 * campaign owner triages. Owner-only operations: list inbox, inspect a
 * petition, and accept or reject. Promoting a petition to a quest is a
 * separate quest_create call with `petitionId` set.
 */
export class PetitionTools {
  protected readonly petitionController = $inject(PetitionController);
  protected readonly campaignController = $inject(CampaignController);

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

  protected reporterName(petition: PetitionResource): string | undefined {
    const reporter = petition.reporter;
    if (!reporter) return undefined;
    return reporter.name || reporter.username || undefined;
  }

  /**
   * Resolve either a global `id` or a per-campaign `shortId` (with campaign
   * context) to the petition's global id.
   */
  protected async resolvePetitionId(
    campaignId: number,
    params: { id?: number; shortId?: number },
  ): Promise<number> {
    if (params.id != null) return params.id;
    if (params.shortId != null) {
      const result = await this.petitionController.listPetitions({
        params: { campaignId },
        query: { status: "all" },
      });
      const found = result.items.find((p) => p.shortId === params.shortId);
      if (!found) {
        throw new NotFoundError(
          `Petition with shortId ${params.shortId} not found in campaign`,
        );
      }
      return found.id;
    }
    throw new BadRequestError(
      "Petition reference required: pass `id` (global) or `shortId` (per-campaign — also requires `campaign` or `campaign_name`).",
    );
  }

  petition_list = $tool({
    description:
      "List petitions (user-submitted bug/feature requests) for a campaign. Owner-only. Defaults to status 'pending' — the inbox the owner needs to triage. Pass status='all' to see everything.",
    title: "List petitions",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: petitionListParamsSchema,
      result: petitionListResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const result = await this.petitionController.listPetitions({
        params: { campaignId },
        query: { status: params.status },
      });

      return {
        petitions: result.items.map((p) => ({
          id: p.id,
          shortId: p.shortId,
          title: p.title,
          tags: p.tags ?? [],
          status: p.status,
          reporterName: this.reporterName(p),
          linkedQuestCount: p.linkedQuests?.length ?? 0,
          createdAt: p.createdAt,
        })),
      };
    },
  });

  petition_get = $tool({
    description:
      "Get full details of a petition by ID, including description, reporter, tags (free-form key=value pairs like type=bug, host=lore.alepha.dev, path=/foo), attachments (id/name/mimeType/size — fetch their content with petition_attachment_get), and linked quests spawned from it.",
    title: "Get petition",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: petitionGetParamsSchema,
      result: petitionGetResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const petitionId = await this.resolvePetitionId(campaignId, params);
      const p = await this.petitionController.getPetition({
        params: { campaignId, petitionId },
      });

      return {
        id: p.id,
        shortId: p.shortId,
        title: p.title,
        description: p.description,
        tags: p.tags ?? [],
        status: p.status,
        reporterName: this.reporterName(p),
        attachments: (p.attachmentUrls ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        })),
        linkedQuests: (p.linkedQuests ?? []).map((q) => ({
          id: q.id,
          shortId: q.shortId,
          title: q.title,
          status: q.status,
        })),
        createdAt: p.createdAt,
      };
    },
  });

  petition_attachment_get = $tool({
    description:
      "Fetch the actual content of one petition attachment. Owner/member-only. For images the bytes are returned inline as an image block — so a screenshot attached to a bug report can be viewed directly. For text-like files (txt/csv/json) the decoded text is returned; other binary types (pdf, xlsx, …) return a metadata note only. Pass `attachmentId` from a petition_get `attachments[].id`.",
    title: "Get petition attachment",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: petitionAttachmentGetParamsSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const petitionId = await this.resolvePetitionId(campaignId, params);
      const file = await this.petitionController.getPetitionAttachment({
        params: { campaignId, petitionId, attachmentId: params.attachmentId },
      });

      if (file.mimeType.startsWith("image/")) {
        return {
          content: [
            { type: "image", data: file.data, mimeType: file.mimeType },
          ],
        };
      }

      // Text-like payloads are decoded inline so the agent can read them;
      // opaque binary types (pdf/xlsx/…) return metadata only.
      if (/^(text\/|application\/(json|csv))/.test(file.mimeType)) {
        const text = Buffer.from(file.data, "base64").toString("utf8");
        return {
          content: [
            {
              type: "text",
              text: `${file.name} (${file.mimeType}, ${file.size} bytes):\n\n${text}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Attachment "${file.name}" is ${file.mimeType} (${file.size} bytes) — not inline-viewable here. Download it from the Lore inbox if you need the raw file.`,
          },
        ],
      };
    },
  });

  petition_accept = $tool({
    description:
      "Accept a pending petition — owner declares the request valid. Status flips pending → accepted. Quests are created separately via quest_create with petitionId set.",
    title: "Accept petition",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: petitionTriageParamsSchema,
      result: petitionTriageResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const petitionId = await this.resolvePetitionId(campaignId, params);
      const result = await this.petitionController.acceptPetition({
        params: { campaignId, petitionId },
      });

      return { ok: result.ok };
    },
  });

  petition_reject = $tool({
    description:
      "Reject a pending petition. Soft state transition — the row remains for audit.",
    title: "Reject petition",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: petitionTriageParamsSchema,
      result: petitionTriageResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );

      const petitionId = await this.resolvePetitionId(campaignId, params);
      const result = await this.petitionController.rejectPetition({
        params: { campaignId, petitionId },
      });

      return { ok: result.ok };
    },
  });
}
