import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { SigilController } from "../../api/controllers/SigilController.ts";
import {
  sigilCreateParamsSchema,
  sigilCreateResultSchema,
  sigilDeleteParamsSchema,
  sigilDeleteResultSchema,
  sigilListParamsSchema,
  sigilListResultSchema,
  sigilRotateParamsSchema,
  sigilRotateResultSchema,
} from "../schemas/index.ts";
import { CampaignTools } from "./CampaignTools.ts";

/**
 * MCP tools for sigils — the credentials applications report with.
 *
 * A **sigil is one environment of one application**: `lore` in `production` is
 * a different sigil from `lore` in `staging`, and they report separately
 * because an error budget shared between them is nobody's budget.
 *
 * These exist so enrolling an app is something an agent can do while it is
 * already in the code that needs enrolling. Listing and reading are open to any
 * campaign member; creating, rotating and deleting are owner-only, and that is
 * enforced in `SigilController` rather than restated here.
 */
export class SigilTools {
  protected readonly sigils = $inject(SigilController);
  protected readonly campaigns = $inject(CampaignTools);

  sigil_list = $tool({
    title: "List sigils",
    description:
      "List a campaign's sigils — which applications and environments are enrolled to report here, and when each last reported. `lastSeenAt` absent means that environment has never sent anything, which distinguishes a quiet app from one that was never wired up. The token is not returned and cannot be: only its prefix is stored in readable form.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: sigilListParamsSchema,
      result: sigilListResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const res = await this.sigils.listSigils({ params: { campaignId } });
      return { sigils: res.items };
    },
  });

  sigil_create = $tool({
    title: "Create a sigil",
    description:
      "Enrol one environment of one application and mint its token. Campaign owner only. `app` + `environment` is the identity — one sigil per pair, and a repeat is rejected rather than silently splitting that environment's history. ⚠️ The returned `token` is the only cleartext copy that will ever exist: it is stored hashed, so nothing can show it again. Hand it to whoever configures the app and do not echo it into a folio, a quest or a commit.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: sigilCreateParamsSchema,
      result: sigilCreateResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      return await this.sigils.createSigil({
        params: { campaignId },
        body: {
          app: params.app,
          environment: params.environment,
          ...(params.label ? { label: params.label } : {}),
        },
      });
    },
  });

  sigil_rotate = $tool({
    title: "Rotate a sigil's token",
    description:
      "Revoke a sigil's token and mint a replacement, keeping the sigil and everything it has ever reported. Campaign owner only. This is the right answer to a leaked token: the old one stops working the instant the hash changes, while views, vitals, unique visitors and the environment's error budget all survive. Prefer it to `sigil_delete`, which throws that history away. ⚠️ The new `token` is shown once — the app must be updated with it or it stops reporting.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: sigilRotateParamsSchema,
      result: sigilRotateResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      return await this.sigils.rotateSigil({
        params: { campaignId, sigilId: params.id },
      });
    },
  });

  sigil_delete = $tool({
    title: "Delete a sigil",
    description:
      "Remove an environment entirely. Campaign owner only. ⚠️ DESTRUCTIVE: the four aggregate tables cascade, so this erases that environment's page views, web vitals, unique visitors and error budget along with the credential. Cannot be undone. If the goal is only to invalidate a leaked token, use `sigil_rotate` instead. Blights already filed survive — a triage decision outlives the credential that surfaced it.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: sigilDeleteParamsSchema,
      result: sigilDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const campaignId = await this.campaigns.resolveCampaignId(
        params.campaign,
        params.campaign_name,
      );
      const res = await this.sigils.deleteSigil({
        params: { campaignId, sigilId: params.id },
      });
      return { ok: res.ok };
    },
  });
}
