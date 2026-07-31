import { randomBytes } from "node:crypto";
import { $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { campaignSources } from "../entities/campaignSources.ts";
import { CampaignSecurityService } from "../services/CampaignSecurityService.ts";

/**
 * Managing which systems may file blights into a campaign.
 *
 * Owner-only throughout. A source key writes into the campaign's inbox, and
 * deciding who may do that is not a membership question — it is the same
 * decision as deciding who may deploy.
 */
export class CampaignSourceController {
  protected readonly log = $logger();
  protected readonly sources = $repository(campaignSources);
  protected readonly security = $inject(CampaignSecurityService);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  listSources = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    method: "GET",
    path: "/c/:campaignId/sources",
    description: "Systems allowed to file blights into this campaign",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      response: z.object({
        items: z.array(
          z.object({
            id: z.uuid(),
            name: z.text(),
            tokenPrefix: z.text(),
            tokenSuffix: z.text(),
            scopes: z.array(z.text()),
            createdAt: z.text(),
            revokedAt: z.text().optional(),
            lastSeenAt: z.text().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const items = await this.sources.findMany({
        where: { campaignId: params.campaignId },
        orderBy: { column: "createdAt", direction: "desc" },
      });
      // The hash never leaves the server: the list names keys by their ends,
      // which is enough to tell them apart and useless to anyone else.
      return {
        items: items.map((s) => ({
          id: s.id,
          name: s.name,
          tokenPrefix: s.tokenPrefix,
          tokenSuffix: s.tokenSuffix,
          scopes: s.scopes ?? [],
          createdAt: s.createdAt,
          revokedAt: s.revokedAt,
          lastSeenAt: s.lastSeenAt,
        })),
      } as any;
    },
  });

  /**
   * Creates a source and returns its key — the only time it exists in the
   * clear.
   *
   * Stored hashed, so it cannot be shown again. An operator who loses it
   * creates another and revokes this one, which is the only contract a hashed
   * secret can honour.
   */
  createSource = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/c/:campaignId/sources",
    description: "Enrol a system and issue its key (shown once)",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      body: z.object({ name: z.text({ minLength: 1, maxLength: 200 }) }),
      response: z.object({
        id: z.uuid(),
        name: z.text(),
        /** Shown once. Never retrievable afterwards. */
        token: z.text(),
      }),
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const token = `src_${randomBytes(24).toString("base64url")}`;
      const created = await this.sources.create({
        campaignId: params.campaignId,
        name: body.name,
        tokenHash: this.crypto.hash(token),
        tokenPrefix: token.slice(0, 12),
        tokenSuffix: token.slice(-6),
        // Written explicitly rather than left to the column default: what a
        // key may do is an authorization decision, and one that silently
        // depends on a default being applied is one that fails closed at the
        // worst moment — or open at a worse one.
        scopes: ["blight:write"],
        createdBy: user.id,
      });

      return { id: created.id, name: created.name, token };
    },
  });

  /**
   * Revokes a source without deleting it.
   *
   * The blights it filed keep pointing at it, so "where did this come from"
   * still has an answer after the key is dead. Deleting the row would null
   * those references and lose the provenance — which is the one thing an audit
   * trail is for.
   */
  revokeSource = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    method: "POST",
    path: "/c/:campaignId/sources/:id/revoke",
    description: "Revoke a source key, keeping what it reported",
    schema: {
      params: z.object({ campaignId: z.integer(), id: z.uuid() }),
      response: z.object({ revokedAt: z.text() }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const revokedAt = new Date(this.dateTime.nowMillis()).toISOString();
      await this.sources.updateById(params.id, { revokedAt } as any);
      return { revokedAt };
    },
  });
}
