import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { CampaignSourceController } from "../../api/controllers/CampaignSourceController.ts";
import {
  sourceCreateParamsSchema,
  sourceCreateResultSchema,
  sourceListParamsSchema,
  sourceListResultSchema,
  sourceRevokeParamsSchema,
  sourceRevokeResultSchema,
} from "../schemas/index.ts";
import { CampaignTools } from "./CampaignTools.ts";

/**
 * MCP tools for the systems allowed to file blights into a campaign.
 *
 * A **source** is a credential issued to an observer — in practice a Pulse
 * instance — which has already deduplicated what it sends. It replaces the
 * sigil model, where the credential went to the website itself and the raw
 * stream landed here.
 *
 * Exposed over MCP because wiring an observer to a campaign is otherwise a
 * click-through in a browser, and the thing doing the wiring is usually an
 * agent setting up a deployment. Every other part of that flow — enrol the app
 * in Pulse, point it at Lore — is already an API call.
 */
export class SourceTools {
  protected readonly sources = $inject(CampaignSourceController);
  protected readonly campaigns = $inject(CampaignTools);

  source_list = $tool({
    title: "List sources",
    description:
      "Systems allowed to file blights into this campaign — typically a Pulse instance. Returns each key by its ends (prefix + suffix) so one can be matched against a key you hold; the key itself is stored hashed and is never returned.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: sourceListParamsSchema,
      result: sourceListResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const res = await this.sources.listSources({ params: { campaignId } });
      return {
        sources: res.items.map((item) => ({
          id: item.id,
          name: item.name,
          tokenPrefix: item.tokenPrefix,
          tokenSuffix: item.tokenSuffix,
          scopes: item.scopes,
          createdAt: item.createdAt,
          revokedAt: item.revokedAt,
          lastUsedAt: item.lastSeenAt,
        })),
      };
    },
  });

  source_create = $tool({
    title: "Create a source",
    description:
      "Enrol a system and issue its key. The key is returned ONCE — only its hash is stored, so it cannot be retrieved afterwards. Hand it to the observer immediately (for Pulse: its `configureLore` call); if it is lost, revoke this source and create another. Campaign owner only.",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: sourceCreateParamsSchema,
      result: sourceCreateResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      return await this.sources.createSource({
        params: { campaignId },
        body: { name: params.name },
      });
    },
  });

  source_revoke = $tool({
    title: "Revoke a source",
    description:
      "Kill a source's key. What it already filed stays, and keeps pointing at it — provenance survives revocation, which is the whole reason this is not a delete. Campaign owner only.",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: sourceRevokeParamsSchema,
      result: sourceRevokeResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const res = await this.sources.revokeSource({
        params: { campaignId, id: params.id },
      });
      return { id: params.id, revokedAt: res.revokedAt };
    },
  });
}
