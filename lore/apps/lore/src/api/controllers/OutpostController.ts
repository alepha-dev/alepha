import { $inject, type Infer, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";
import { outpostApps } from "../entities/outpostApps.ts";
import { type Outpost, outposts } from "../entities/outposts.ts";
import { CampaignSecurityService } from "../services/CampaignSecurityService.ts";
import { OutpostTokenService } from "../services/OutpostTokenService.ts";

/**
 * An outpost as the campaign's settings page sees it.
 *
 * `tokenHash` is absent and `tokenPrefix` is present, for the same reason a
 * sigil keeps a prefix: the UI has to name a credential it can never rebuild.
 */
const outpostResourceSchema = z.object({
  id: z.uuid(),
  campaignId: z.integer(),
  label: z.string(),
  tokenPrefix: z.string(),
  agent: z.string().optional(),
  baseDomain: z.string().optional(),
  createdAt: z.string(),
  /** Last time this machine reported. Absent means never — it never connected. */
  lastSeenAt: z.string().optional(),
  /** How many instances it is currently hosting. */
  appCount: z.integer(),
});

export type OutpostResource = Infer<typeof outpostResourceSchema>;

/**
 * An outpost plus the one cleartext copy of its token that will ever exist.
 */
const mintedOutpostSchema = outpostResourceSchema.extend({
  token: z.string(),
});

export type MintedOutpost = Infer<typeof mintedOutpostSchema>;

/**
 * Owner-facing CRUD for outposts — one credential per machine.
 *
 * Reads member-gated, mutations owner-gated, the same split the rest of the app
 * uses. Note what is deliberately absent: there is no endpoint here that
 * *reaches* a machine. Lore never calls out, so there is nothing to expose.
 */
export class OutpostController {
  protected outposts = $repository(outposts);
  protected apps = $repository(outpostApps);
  protected security = $inject(CampaignSecurityService);
  protected tokens = $inject(OutpostTokenService);

  /**
   * Enrol a machine, and hand back its token once.
   *
   * No uniqueness beyond the token: two outposts with the same label are a
   * naming annoyance, not a data problem, and the identity is the credential.
   * That is the opposite of a sigil, where `(campaign, app, environment)` must
   * be unique because a second row would split an environment's history.
   */
  createOutpost = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/outposts",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      body: z.object({ label: z.string().min(1).max(200) }),
      response: mintedOutpostSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const minted = this.tokens.mint();
      const created = await this.outposts.create({
        campaignId: params.campaignId,
        label: body.label.trim(),
        tokenHash: minted.hash,
        tokenPrefix: minted.prefix,
        createdBy: user?.id,
      });
      return { ...this.toResource(created, 0), token: minted.token };
    },
  });

  listOutposts = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/campaigns/:campaignId/outposts",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      response: z.array(outpostResourceSchema),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const rows = await this.outposts.findMany({
        where: { campaignId: { eq: params.campaignId } },
      });
      return await Promise.all(
        rows.map(async (row) =>
          this.toResource(
            row,
            (await this.apps.findMany({ where: { outpostId: { eq: row.id } } }))
              .length,
          ),
        ),
      );
    },
  });

  /**
   * Re-mint the token in place.
   *
   * **This is how you revoke.** `verify` resolves a machine *by* its token
   * hash, so overwriting the column stops the old token the instant it lands,
   * and every app row and deploy event stays attached. Deleting the outpost
   * also revokes — and cascades the timeline away with it, which is the thing
   * the outpost existed to build.
   */
  rotateOutpost = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/campaigns/:campaignId/outposts/:outpostId/rotate",
    schema: {
      params: z.object({ campaignId: z.integer(), outpostId: z.uuid() }),
      response: mintedOutpostSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const existing = await this.find(params.campaignId, params.outpostId);

      const minted = this.tokens.mint();
      await this.outposts.updateMany(
        { id: { eq: existing.id } },
        { tokenHash: minted.hash, tokenPrefix: minted.prefix },
      );
      return {
        ...this.toResource(
          { ...existing, tokenPrefix: minted.prefix },
          (
            await this.apps.findMany({
              where: { outpostId: { eq: existing.id } },
            })
          ).length,
        ),
        token: minted.token,
      };
    },
  });

  deleteOutpost = $action({
    use: [$secure({ permissions: ["campaign:delete"] })],
    method: "DELETE",
    path: "/campaigns/:campaignId/outposts/:outpostId",
    schema: {
      params: z.object({ campaignId: z.integer(), outpostId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const existing = await this.find(params.campaignId, params.outpostId);
      await this.outposts.deleteMany({ id: { eq: existing.id } });
      return { ok: true };
    },
  });

  /**
   * Looks an outpost up **within** the campaign from the path.
   *
   * Scoped rather than fetched by id alone: without the campaign in the where
   * clause, an owner of any campaign could rotate or delete a machine belonging
   * to another, because the ownership check above only proves they own the
   * campaign they named.
   */
  protected async find(campaignId: number, outpostId: string) {
    const found = await this.outposts.findOne({
      where: { id: { eq: outpostId }, campaignId: { eq: campaignId } },
    });
    if (!found) {
      throw new NotFoundError("Outpost not found");
    }
    return found;
  }

  protected toResource(row: Outpost, appCount: number): OutpostResource {
    return {
      id: row.id,
      campaignId: row.campaignId,
      label: row.label,
      tokenPrefix: row.tokenPrefix,
      agent: row.agent,
      baseDomain: row.baseDomain,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      appCount,
    };
  }
}
