import { $inject, t } from "alepha";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError, okSchema } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { campaigns } from "../entities/campaigns.ts";
import { chapters } from "../entities/chapters.ts";
import { type Character, characters } from "../entities/characters.ts";
import { quests } from "../entities/quests.ts";
import type { User } from "../entities/users.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class CampaignController {
  log = $logger();
  campaigns = $repository(campaigns);
  characters = $repository(characters);
  quests = $repository(quests);
  chapters = $repository(chapters);
  users = $repository(users);
  security = $inject(AppSecurityProvider);
  questMapper = $inject(QuestResourceMapper);

  createCampaign = $action({
    use: [$secure({ permissions: ["campaign:create"] })],
    schema: {
      body: t.pick(campaigns.insertSchema, ["title", "public"]),
      response: campaigns.schema,
    },
    handler: async ({ body, user }) => {
      // TODO: load user + check if they have a free campaign slot

      const count = await this.campaigns.count({
        createdBy: { eq: user.id },
      });

      if (count >= 5) {
        throw new ForbiddenError(
          "You have reached the maximum number of campaigns allowed.",
        );
      }

      const campaign = await this.campaigns.create({
        ...body,
        createdBy: user.id,
      });

      await this.characters.create({
        campaignId: campaign.id,
        userId: user.id,
        xp: 0,
        balance: 0,
        owner: true,
      });

      return campaign;
    },
  });

  getMyCampaigns = $action({
    use: [
      $secure({ permissions: ["campaign:read"] }),
      $etag({
        control: { private: true, maxAge: 30, staleWhileRevalidate: 120 },
      }),
    ],
    description: "Get all campaigns for the authenticated user",
    schema: {
      query: pageQuerySchema,
      response: t.array(campaigns.schema),
    },
    handler: async ({ user }) => {
      const userCharacters = await this.characters.findMany({
        where: { userId: { eq: user.id } },
      });

      const characterCampaignIds = userCharacters.map((it) => it.campaignId);
      if (characterCampaignIds.length === 0) {
        return [];
      }

      return await this.campaigns.findMany({
        where: { id: { inArray: characterCampaignIds } },
        limit: characterCampaignIds.length,
      });
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  getCampaignUsers = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.array(users.schema),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const campaignCharacters = await this.characters.findMany({
        where: { campaignId: { eq: params.id } },
      });

      const userIds = campaignCharacters.map((it) => it.userId);

      return await this.users.findMany({
        where: { id: { inArray: userIds } },
        limit: userIds.length,
      });
    },
  });

  updateCampaignById = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.partial(
        t.pick(campaigns.insertSchema, ["title", "public", "whiteboard"]),
      ),
      response: campaigns.schema,
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.checkOwnership(params.id, user);

      if (body.title) {
        campaign.title = body.title.trim();
      }

      if (body.public != null) {
        campaign.public = body.public;
      }

      if (body.whiteboard != null) {
        campaign.whiteboard = body.whiteboard;
      }

      await this.campaigns.save(campaign);
      return campaign;
    },
  });

  getCampaignById = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.extend(campaigns.schema, {
        character: t.optional(characters.schema),
        quests: t.array(questResourceSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.checkOwnership(params.id, user);

      const character = await this.characters.findOne({
        where: {
          campaignId: { eq: params.id },
          userId: { eq: user.id },
        },
      });

      if (!character && !campaign.public) {
        throw new ForbiddenError("Not a member of this campaign");
      }

      const campaignQuests = await this.quests.findMany({
        where: {
          campaignId: { eq: params.id },
          completedAt: { isNull: true },
          acceptedBy: { eq: user.id },
        },
      });

      return {
        ...campaign,
        quests: campaignQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
        character,
      };
    },
  });

  getCampaignAdventurers = $action({
    use: [
      $secure({ permissions: ["campaign:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
    ],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.array(
        t.extend(characters.schema, {
          user: users.schema,
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const campaignCharacters = await this.characters.findMany({
        where: { campaignId: { eq: params.id } },
      });

      const campaignUsers = await this.users.findMany({
        limit: campaignCharacters.length,
        where: {
          id: { inArray: campaignCharacters.map((char) => char.userId) },
        },
      });

      const charactersWithUsers: Array<
        Character & {
          user: User;
        }
      > = [];

      for (const character of campaignCharacters) {
        const characterUser = campaignUsers.find(
          (it) => it.id === character.userId,
        );
        if (!characterUser) {
          this.log.warn(
            `User with id ${character.userId} not found for character ${character.id}`,
          );
          continue;
        }
        charactersWithUsers.push({
          ...character,
          user: characterUser,
        });
      }

      // Sort by owner first, then by creation date
      return charactersWithUsers.sort((a, b) => {
        if (a.owner && !b.owner) return -1;
        if (!a.owner && b.owner) return 1;
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    },
  });

  deleteCampaignById = $action({
    use: [$secure({ permissions: ["campaign:delete"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      await this.campaigns.deleteById(params.id);
      await this.characters.deleteMany({
        campaignId: { eq: params.id },
      });
      await this.quests.deleteMany({
        campaignId: { eq: params.id },
      });

      return { ok: true };
    },
  });

  renameZone = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        oldZoneName: t.string(),
        newZoneName: t.string({ minLength: 1 }),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.checkOwnership(params.id, user);

      // Update all quests with the old zone name to the new one
      const questsToUpdate = await this.quests.findMany({
        where: {
          campaignId: { eq: params.id },
          zone: { eq: body.oldZoneName },
        },
      });

      // Update each quest's zone field
      for (const quest of questsToUpdate) {
        await this.quests.updateById(quest.id, {
          zone: body.newZoneName,
        });
      }

      // Update the campaign's zones array
      const updatedZones = campaign.zones.map((pkg) =>
        pkg === body.oldZoneName ? body.newZoneName : pkg,
      );

      await this.campaigns.updateById(params.id, {
        zones: updatedZones,
      });

      return { ok: true };
    },
  });
}
