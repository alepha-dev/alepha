import { $inject, t } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError, NotFoundError } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { AchievementEngine } from "../services/AchievementEngine.ts";

export class CharacterController {
  characters = $repository(characters);
  campaigns = $repository(campaigns);
  security = $inject(AppSecurityProvider);
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
      params: t.object({
        campaignId: t.integer(),
      }),
      response: t.array(
        t.object({
          key: t.string(),
          label: t.string(),
          description: t.string(),
          icon: t.string(),
          target: t.integer({ minimum: 1 }),
          current: t.integer({ minimum: 0 }),
          earned: t.boolean(),
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
        campaignCharacterCount: 0,
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
      response: t.array(
        t.object({
          id: t.integer(),
          campaignId: t.integer(),
          campaignTitle: t.string(),
          xp: t.integer(),
          balance: t.integer(),
          owner: t.optional(t.boolean()),
          createdAt: t.datetime(),
          updatedAt: t.datetime(),
        }),
      ),
    },
    handler: async ({ user }) => {
      const userCharacters = await this.characters.findMany({
        where: { userId: { eq: user.id } },
      });
      const userCharacterIds = userCharacters.map((c) => c.id);

      if (userCharacterIds.length === 0) {
        return [];
      }

      // Fetch campaigns for each character
      const userCampaigns = await this.campaigns.findMany({
        where: { id: { inArray: userCharacters.map((c) => c.campaignId) } },
      });

      return (
        await Promise.all(
          userCharacters.map(async (character) => {
            const campaign = userCampaigns.find(
              (p) => p.id === character.campaignId,
            );
            if (!campaign) {
              return;
            }

            return {
              id: character.id,
              campaignId: character.campaignId,
              campaignTitle: campaign?.title ?? "Unknown Campaign",
              xp: character.xp,
              balance: character.balance,
              owner: character.owner,
              createdAt: character.createdAt,
              updatedAt: character.updatedAt,
            };
          }),
        )
      ).filter((it) => !!it);
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
      params: t.object({
        campaignId: t.integer(),
      }),
      body: t.object({
        alias: t.optional(
          t.nullable(t.string({ minLength: 1, maxLength: 60 })),
        ),
        picture: t.optional(t.nullable(t.uuid())),
        equippedTitle: t.optional(t.nullable(t.string())),
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
