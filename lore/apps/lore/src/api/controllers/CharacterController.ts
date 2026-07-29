import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError, NotFoundError } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { relations } from "../relations.ts";
import { AchievementEngine } from "../services/AchievementEngine.ts";
import { CampaignSecurityService } from "../services/CampaignSecurityService.ts";

export class CharacterController {
  characters = $repository(characters);
  /** ...with the campaign each one belongs to, for the cross-campaign list. */
  charactersWith = $repository(relations, "characters");
  campaigns = $repository(campaigns);
  security = $inject(CampaignSecurityService);
  achievements = $inject(AchievementEngine);

  /**
   * Public catalog of all server-defined achievements with per-character
   * progress for the caller's character in the given campaign. The page
   * renders each entry with Steam-style `current / target` and a bar
   * even when the achievement is still locked.
   */
  listAchievements = $action({
    use: [$secure({ permissions: ["character:read"] })],
    schema: {
      params: z.object({
        campaignId: z.integer(),
      }),
      response: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          description: z.string(),
          icon: z.string(),
          target: z.integer().min(1),
          current: z.integer().min(0),
          earned: z.boolean(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(
        params.campaignId,
        user,
      );
      const character = await this.characters.findOne({
        where: {
          campaignId: { eq: params.campaignId },
          userId: { eq: user.id },
        },
      });
      const catalog = this.achievements.list();
      if (!character) {
        // No character (shouldn't happen for members, but defend): catalog
        // with zero progress + locked.
        return catalog.map((a) => ({ ...a, current: 0, earned: false }));
      }

      const ctx = {
        character,
        campaignZones: campaign.zones ?? [],
      };

      // Reconciliation step: a predicate may be satisfied even though
      // the matching event never fired during the character's lifetime
      // (e.g. they crossed the threshold before the achievement was
      // registered). `evaluateAll` runs every predicate; any newly-true
      // key gets persisted now so the page reflects reality on the
      // first request after the catalog is fetched.
      const newlyGranted = await this.achievements.evaluateAll(ctx);
      if (newlyGranted.length > 0) {
        character.achievements = this.achievements.grant(
          character,
          newlyGranted,
        );
        await this.characters.save(character);
      }

      const earned = new Set(character.achievements ?? []);
      const progress = await this.achievements.progressFor(ctx);
      return catalog.map((a) => ({
        ...a,
        current: progress.get(a.key) ?? 0,
        earned: earned.has(a.key),
      }));
    },
  });

  getMyCharacters = $action({
    use: [$secure({ permissions: ["character:read"] })],
    schema: {
      response: z.array(
        z.object({
          id: z.integer(),
          campaignId: z.integer(),
          campaignTitle: z.string(),
          xp: z.integer(),
          balance: z.integer(),
          owner: z.boolean().optional(),
          createdAt: z.datetime(),
          updatedAt: z.datetime(),
        }),
      ),
    },
    handler: async ({ user }) => {
      const userCharacters = await this.charactersWith.findMany({
        where: { userId: { eq: user.id } },
        include: { campaign: true },
      });

      return userCharacters
        .filter((character) => !!character.campaign)
        .map((character) => ({
          id: character.id,
          campaignId: character.campaignId,
          campaignTitle: character.campaign?.title ?? "Unknown Campaign",
          xp: character.xp,
          balance: character.balance,
          owner: character.owner,
          createdAt: character.createdAt,
          updatedAt: character.updatedAt,
        }));
    },
  });

  /**
   * Patch the caller's character in `campaignId`. Only the viewer can edit
   * their own character — there is no "edit someone else's character" path.
   * `equippedTitle` must be one of the granted `achievements` (server-enforced).
   * Pass `null` to clear a field; omit it to leave it unchanged.
   */
  updateMyCharacter = $action({
    use: [$secure({ permissions: ["character:write"] })],
    schema: {
      params: z.object({
        campaignId: z.integer(),
      }),
      body: z.object({
        alias: z.string().min(1).max(60).nullable().optional(),
        picture: z.uuid().nullable().optional(),
        equippedTitle: z.string().nullable().optional(),
      }),
      response: characters.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.campaignId, user);

      const character = await this.characters.findOne({
        where: {
          userId: { eq: user.id },
          campaignId: { eq: params.campaignId },
        },
      });
      if (!character) {
        throw new NotFoundError("Character not found");
      }

      if (
        body.equippedTitle &&
        !(character.achievements ?? []).includes(body.equippedTitle)
      ) {
        throw new ForbiddenError(
          "Cannot equip a title for an unearned achievement",
        );
      }

      const patch: Partial<typeof character> = {};
      if (body.alias !== undefined) patch.alias = body.alias ?? undefined;
      if (body.picture !== undefined) patch.picture = body.picture ?? undefined;
      if (body.equippedTitle !== undefined) {
        patch.equippedTitle = body.equippedTitle ?? undefined;
      }

      await this.characters.updateById(character.id, patch);
      return (await this.characters.getOne({
        where: { id: { eq: character.id } },
      })) as typeof character;
    },
  });
}
