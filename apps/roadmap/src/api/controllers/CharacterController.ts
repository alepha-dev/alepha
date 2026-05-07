import { t } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";

export class CharacterController {
  characters = $repository(characters);
  campaigns = $repository(campaigns);

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
}
