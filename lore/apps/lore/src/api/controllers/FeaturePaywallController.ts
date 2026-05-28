import { $inject, t } from "alepha";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { FeaturePaywallService } from "../services/FeaturePaywallService.ts";
import { FeatureRegistry } from "../services/FeatureRegistry.ts";

const featureSchema = t.object({
  key: t.string(),
  label: t.string(),
  description: t.string(),
  price: t.integer({ minimum: 0 }),
  unlocked: t.boolean(),
  sponsoredBy: t.optional(
    t.object({
      characterId: t.integer(),
      price: t.integer({ minimum: 0 }),
      at: t.datetime(),
    }),
  ),
});

export class FeaturePaywallController {
  campaigns = $repository(campaigns);
  characters = $repository(characters);
  registry = $inject(FeatureRegistry);
  paywall = $inject(FeaturePaywallService);
  security = $inject(AppSecurityProvider);

  /**
   * List every paywalled feature with its unlocked state for the
   * campaign. Each entry includes the sponsor's character id + the price
   * paid + the at-time when unlocked (from `campaigns.unlockHistory`), so
   * the UI can render the "Sponsored by Alice on 2026-04-12" credit
   * line.
   */
  listFeatures = $action({
    method: "GET",
    path: "/campaigns/:campaignId/features",
    use: [$secure({ permissions: ["campaign:read"] })],
    schema: {
      params: t.object({ campaignId: t.integer() }),
      response: t.array(featureSchema),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(
        params.campaignId,
        user,
      );
      const unlocked = new Set(campaign.unlockedFeatures ?? []);
      const history = campaign.unlockHistory ?? [];

      return this.registry.list().map((feature) => {
        const credit = history.find((h) => h.feature === feature.key);
        return {
          ...feature,
          unlocked: unlocked.has(feature.key),
          sponsoredBy: credit
            ? {
                characterId: credit.characterId,
                price: credit.price,
                at: credit.at,
              }
            : undefined,
        };
      });
    },
  });

  /**
   * Debug-only reset: wipe the campaign's purchased features so the
   * paywall flow can be tested end-to-end without standing up a fresh
   * campaign. Owner-only. Does NOT refund the character's balance —
   * keeping the gold makes re-buying easy in the same session.
   */
  resetFeatures = $action({
    method: "POST",
    path: "/campaigns/:campaignId/features/reset",
    use: [$secure({ permissions: ["campaign:update"] }), $transactional()],
    schema: {
      params: t.object({
        campaignId: t.integer(),
      }),
      response: campaigns.schema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.campaignId, user);
      const campaign = await this.campaigns.getOne({
        where: { id: { eq: params.campaignId } },
      });
      campaign.unlockedFeatures = [];
      campaign.unlockHistory = [];
      await this.campaigns.save(campaign);
      return campaign;
    },
  });

  /**
   * Buy a feature from the caller's character — single-payer Shop
   * action. `$transactional()` makes the read/check/write a single unit
   * — two concurrent purchases end with exactly one debit + one unlock;
   * the loser sees the "already unlocked" error and the UI can refresh.
   */
  buyFeature = $action({
    method: "POST",
    path: "/campaigns/:campaignId/features/:featureKey/buy",
    use: [$secure({ permissions: ["campaign:read"] }), $transactional()],
    schema: {
      params: t.object({
        campaignId: t.integer(),
        featureKey: t.string(),
      }),
      response: t.object({
        campaign: campaigns.schema,
        character: characters.schema,
      }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const character = await this.characters.findOne({
        where: {
          campaignId: { eq: params.campaignId },
          userId: { eq: user.id },
        },
      });
      if (!character) {
        throw new NotFoundError("Character not found");
      }
      const result = await this.paywall.buy(
        params.campaignId,
        character,
        params.featureKey,
      );
      return {
        campaign: result.campaign,
        character: result.character,
      };
    },
  });
}
