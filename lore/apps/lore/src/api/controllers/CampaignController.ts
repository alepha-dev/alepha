import { $inject, Alepha, t } from "alepha";
import { files } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $bucket } from "alepha/bucket";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema } from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { $etag } from "alepha/server/etag";
import { campaignOptionsAtom } from "../atoms/campaignOptionsAtom.ts";
import {
  campaignFeaturesSchema,
  campaigns,
  defaultCampaignFeatures,
} from "../entities/campaigns.ts";
import { chapters } from "../entities/chapters.ts";
import { type Character, characters } from "../entities/characters.ts";
import { quests } from "../entities/quests.ts";
import type { User } from "../entities/users.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class CampaignController {
  log = $logger();
  alepha = $inject(Alepha);
  campaigns = $repository(campaigns);
  characters = $repository(characters);
  quests = $repository(quests);
  chapters = $repository(chapters);
  users = $repository(users);
  fileRepo = $repository(files);
  security = $inject(AppSecurityProvider);
  questMapper = $inject(QuestResourceMapper);

  /**
   * Bucket for campaign icons (avatars). Image-only, 2 MB cap.
   */
  iconBucket = $bucket({
    name: "campaign-icons",
    maxSize: 2 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  });

  createCampaign = $action({
    use: [$secure({ permissions: ["campaign:create"] })],
    schema: {
      body: t.extend(t.pick(campaigns.insertSchema, ["title", "icon"]), {
        /**
         * Subset of module toggles to override at creation time. Anything
         * omitted falls back to `defaultCampaignFeatures`. Lets the wizard
         * surface a "select modules" step without forcing the client to
         * resend the full feature payload.
         */
        features: t.optional(t.partial(campaignFeaturesSchema)),
      }),
      response: campaigns.schema,
    },
    handler: async ({ body, user }) => {
      const { maxCampaignsPerUser } =
        this.alepha.store.get(campaignOptionsAtom);
      const count = await this.campaigns.count({
        createdBy: { eq: user.id },
      });

      if (count >= maxCampaignsPerUser) {
        throw new ForbiddenError(
          `You have reached the maximum number of campaigns allowed (${maxCampaignsPerUser}).`,
        );
      }

      if (body.icon) {
        await this.assertIconBelongsToUser(body.icon, user);
      }

      const campaign = await this.campaigns.create({
        ...body,
        features: { ...defaultCampaignFeatures, ...(body.features ?? {}) },
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
    handler: async ({ user, query }) => {
      const userCharacters = await this.characters.findMany({
        where: { userId: { eq: user.id } },
      });

      const characterCampaignIds = userCharacters.map((it) => it.campaignId);
      if (characterCampaignIds.length === 0) {
        return [];
      }

      const result = await this.campaigns.paginate(
        {
          size: query.size ?? characterCampaignIds.length,
          sort: query.sort ?? "-updatedAt",
          page: query.page ?? 0,
        },
        { where: { id: { inArray: characterCampaignIds } } },
      );
      return result.content;
    },
  });

  /**
   * One-shot Home page bootstrap: every campaign the user is a member of
   * (no cap — the per-user ownership limit keeps the list bounded), plus
   * the quota state needed to gate the "Create campaign" CTA.
   */
  getHomeOverview = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    schema: {
      response: t.object({
        campaigns: t.array(campaigns.schema),
        totalCount: t.integer(),
        ownedCount: t.integer(),
        maxCampaigns: t.integer(),
        canCreate: t.boolean(),
      }),
    },
    handler: async ({ user }) => {
      const { maxCampaignsPerUser } =
        this.alepha.store.get(campaignOptionsAtom);

      const userCharacters = await this.characters.findMany({
        where: { userId: { eq: user.id } },
      });
      const characterCampaignIds = userCharacters.map((it) => it.campaignId);

      const ownedCount = await this.campaigns.count({
        createdBy: { eq: user.id },
      });
      const canCreate = ownedCount < maxCampaignsPerUser;

      if (characterCampaignIds.length === 0) {
        return {
          campaigns: [],
          totalCount: 0,
          ownedCount,
          maxCampaigns: maxCampaignsPerUser,
          canCreate,
        };
      }

      const result = await this.campaigns.findMany({
        where: { id: { inArray: characterCampaignIds } },
        orderBy: [{ column: "updatedAt", direction: "desc" }],
        limit: characterCampaignIds.length,
      });

      return {
        campaigns: result,
        totalCount: result.length,
        ownedCount,
        maxCampaigns: maxCampaignsPerUser,
        canCreate,
      };
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
      await this.security.assertMember(params.id, user);

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
      body: t.object({
        title: t.optional(
          t.string({
            minLength: 3,
            maxLength: 24,
          }),
        ),
        icon: t.optional(t.nullable(t.uuid())),
        features: t.optional(t.partial(campaignFeaturesSchema)),
        chapterDuration: t.optional(t.nullable(t.string())),
      }),
      response: campaigns.schema,
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.assertOwner(params.id, user);

      if (body.title) {
        campaign.title = body.title.trim();
      }

      if ("icon" in body) {
        if (body.icon == null) {
          campaign.icon = undefined;
        } else {
          await this.assertIconBelongsToUser(body.icon, user);
          campaign.icon = body.icon;
        }
      }

      if ("chapterDuration" in body) {
        campaign.chapterDuration = body.chapterDuration ?? undefined;
      }

      if (body.features) {
        campaign.features = {
          ...defaultCampaignFeatures,
          ...campaign.features,
          ...body.features,
        };
      }

      await this.campaigns.save(campaign);
      return campaign;
    },
  });

  protected async assertIconBelongsToUser(
    iconId: string,
    user: UserAccountToken,
  ): Promise<void> {
    const found = await this.fileRepo.findOne({
      where: {
        id: { eq: iconId },
        creator: { eq: user.id },
        bucket: { eq: this.iconBucket.name },
      },
    });
    if (!found) {
      throw new BadRequestError("Invalid icon reference");
    }
  }

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
      const { campaign } = await this.security.assertMember(params.id, user);

      const character = await this.characters.findOne({
        where: {
          campaignId: { eq: params.id },
          userId: { eq: user.id },
        },
      });

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
      await this.security.assertMember(params.id, user);

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
      await this.security.assertOwner(params.id, user);

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

  leaveCampaign = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const campaign = await this.campaigns.getOne({
        where: { id: { eq: params.id } },
      });

      // Owner cannot leave their own campaign — they must delete it or
      // transfer ownership (transfer not implemented yet).
      if (campaign.createdBy === user.id) {
        throw new ForbiddenError(
          "The owner cannot leave their own campaign. Delete it instead.",
        );
      }

      const character = await this.characters.findOne({
        where: {
          userId: { eq: user.id },
          campaignId: { eq: params.id },
        },
      });

      if (!character) {
        // Idempotent: leaving a campaign you're not a member of is a no-op.
        return { ok: true };
      }

      // Release any in-flight quests the user accepted but did not complete,
      // so other members can pick them up. Completed quests stay attributed.
      await this.quests.updateMany(
        {
          campaignId: { eq: params.id },
          acceptedBy: { eq: user.id },
          completedAt: { isNull: true },
        },
        {
          acceptedAt: null,
          acceptedBy: null,
        },
      );

      // Drops the user's XP, balance and character state in this campaign.
      await this.characters.deleteById(character.id);

      return { ok: true };
    },
  });

  getZones = $action({
    use: [$secure({ permissions: ["campaign:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.array(
        t.object({
          name: t.string(),
          questCount: t.integer(),
          firstQuestAt: t.optional(t.string()),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      const { campaign } = await this.security.assertMember(params.id, user);

      const campaignQuests = await this.quests.findMany({
        where: { campaignId: { eq: params.id } },
      });

      // Aggregate per zone: union of campaign.zones + zones found on quests so
      // empty zones (no quests) still appear, and orphan zones (quest with a
      // zone the campaign forgot) aren't lost.
      const stats = new Map<
        string,
        { questCount: number; firstQuestAt?: string }
      >();
      for (const name of campaign.zones ?? []) {
        stats.set(name, { questCount: 0 });
      }
      for (const quest of campaignQuests) {
        const prev = stats.get(quest.zone) ?? { questCount: 0 };
        const ts =
          typeof quest.createdAt === "string"
            ? quest.createdAt
            : new Date(quest.createdAt as never).toISOString();
        const firstQuestAt =
          prev.firstQuestAt && prev.firstQuestAt < ts ? prev.firstQuestAt : ts;
        stats.set(quest.zone, {
          questCount: prev.questCount + 1,
          firstQuestAt,
        });
      }

      return [...stats.entries()]
        .map(([name, s]) => ({
          name,
          questCount: s.questCount,
          firstQuestAt: s.firstQuestAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
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
      const { campaign } = await this.security.assertOwner(params.id, user);

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

  // ── Kanban column CRUD ──────────────────────────────────────────────

  addKanbanColumn = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    schema: {
      params: t.object({ id: t.integer() }),
      body: t.object({
        name: t.string({ minLength: 1, maxLength: 24 }),
      }),
      response: t.array(t.string()),
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.assertOwner(params.id, user);
      const current = campaign.kanbanColumns ?? [];
      const name = body.name.trim();
      if (!name) {
        throw new BadRequestError("Column name must not be empty.");
      }
      if (current.length >= 5) {
        throw new BadRequestError(
          "A campaign can have at most 5 kanban columns.",
        );
      }
      if (current.includes(name)) {
        throw new BadRequestError("A column with this name already exists.");
      }
      const updated = [...current, name];
      await this.campaigns.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  renameKanbanColumn = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    schema: {
      params: t.object({ id: t.integer() }),
      body: t.object({
        oldName: t.string(),
        newName: t.string({ minLength: 1, maxLength: 24 }),
      }),
      response: t.array(t.string()),
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.assertOwner(params.id, user);
      const current = campaign.kanbanColumns ?? [];
      const newName = body.newName.trim();
      if (!current.includes(body.oldName)) {
        throw new BadRequestError("Column not found.");
      }
      if (newName === body.oldName) return current;
      if (current.includes(newName)) {
        throw new BadRequestError("A column with this name already exists.");
      }

      // Cascade-rename onto every quest that lives in that column.
      const affected = await this.quests.findMany({
        where: {
          campaignId: { eq: params.id },
          kanbanColumn: { eq: body.oldName },
        },
      });
      for (const quest of affected) {
        await this.quests.updateById(quest.id, { kanbanColumn: newName });
      }

      const updated = current.map((c) => (c === body.oldName ? newName : c));
      await this.campaigns.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  deleteKanbanColumn = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    schema: {
      params: t.object({ id: t.integer() }),
      body: t.object({ name: t.string() }),
      response: t.array(t.string()),
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.assertOwner(params.id, user);
      const current = campaign.kanbanColumns ?? [];
      if (!current.includes(body.name)) {
        throw new BadRequestError("Column not found.");
      }
      if (current.length <= 1) {
        throw new BadRequestError("A campaign must keep at least one column.");
      }

      // Refuse if any quest still lives in this column.
      const occupants = await this.quests.count({
        campaignId: { eq: params.id },
        kanbanColumn: { eq: body.name },
      });
      if (occupants > 0) {
        throw new BadRequestError(
          "Move or complete the quests in this column before deleting it.",
        );
      }

      const updated = current.filter((c) => c !== body.name);
      await this.campaigns.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  reorderKanbanColumns = $action({
    use: [$secure({ permissions: ["campaign:update"] })],
    schema: {
      params: t.object({ id: t.integer() }),
      body: t.object({
        columns: t.array(t.string(), { minItems: 1, maxItems: 5 }),
      }),
      response: t.array(t.string()),
    },
    handler: async ({ params, body, user }) => {
      const { campaign } = await this.security.assertOwner(params.id, user);
      const current = campaign.kanbanColumns ?? [];
      // Must reorder the exact same set — additions/removals go through the
      // dedicated endpoints so concurrent edits can't drop a column silently.
      if (
        body.columns.length !== current.length ||
        new Set(body.columns).size !== body.columns.length ||
        body.columns.some((c) => !current.includes(c))
      ) {
        throw new BadRequestError(
          "Reordered list must contain the same columns.",
        );
      }
      await this.campaigns.updateById(params.id, {
        kanbanColumns: body.columns,
      });
      return body.columns;
    },
  });
}
