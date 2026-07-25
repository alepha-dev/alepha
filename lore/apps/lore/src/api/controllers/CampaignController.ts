import { $inject, Alepha, z } from "alepha";
import { files } from "alepha/api/files";
import { users } from "alepha/api/users";
import { $bucket } from "alepha/bucket";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema } from "alepha/orm";
import {
  $owns,
  $secure,
  OwnedResourceProvider,
  type UserAccountToken,
} from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { $etag } from "alepha/server/etag";
import {
  type Campaign,
  campaignFeaturesSchema,
  campaigns,
  defaultCampaignFeatures,
} from "../entities/campaigns.ts";
import { chapters } from "../entities/chapters.ts";
import { type Character, characters } from "../entities/characters.ts";
import { quests } from "../entities/quests.ts";
import type { User } from "../entities/users.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { AchievementEngine } from "../services/AchievementEngine.ts";
import { CampaignLimits } from "../services/CampaignLimits.ts";
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
  owned = $inject(OwnedResourceProvider);

  /**
   * Campaign-member gate: the campaign creator, or any user holding a
   * character in it. Privileged identities bypass both.
   */
  protected ownsAsMember = () =>
    $owns({
      repository: () => this.campaigns,
      param: "id",
      owner: "createdBy",
      cast: Number,
      via: {
        repository: () => this.characters,
        resource: "campaignId",
        user: "userId",
      },
      message: "Not a member of this campaign",
    });

  /**
   * Campaign-owner gate: the creator only. Used for destructive and
   * configuration endpoints.
   */
  protected ownsAsOwner = () =>
    $owns({
      repository: () => this.campaigns,
      param: "id",
      owner: "createdBy",
      cast: Number,
      message: "Only the campaign owner can perform this action",
    });
  questMapper = $inject(QuestResourceMapper);
  achievements = $inject(AchievementEngine);
  limits = $inject(CampaignLimits);

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
      body: campaigns.insertSchema.pick({ title: true, icon: true }).extend({
        /**
         * Subset of module toggles to override at creation time. Anything
         * omitted falls back to `defaultCampaignFeatures`. Lets the wizard
         * surface a "select modules" step without forcing the client to
         * resend the full feature payload.
         */
        features: campaignFeaturesSchema.partial().optional(),
      }),
      response: campaigns.schema,
    },
    handler: async ({ body, user }) => {
      const maxCampaignsPerUser = await this.limits.maxCampaignsPerUser();
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

      const ownerCharacter = await this.characters.create({
        campaignId: campaign.id,
        userId: user.id,
        xp: 0,
        balance: 0,
        owner: true,
      });

      // Founder achievement: granted on the owner's character at creation.
      const granted = await this.achievements.evaluate(
        { type: "character.created" },
        {
          character: ownerCharacter,
          campaignZones: campaign.zones ?? [],
        },
      );
      if (granted.length > 0) {
        ownerCharacter.achievements = this.achievements.grant(
          ownerCharacter,
          granted,
        );
        await this.characters.save(ownerCharacter);
      }

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
      response: z.array(campaigns.schema),
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
      response: z.object({
        campaigns: z.array(campaigns.schema),
        totalCount: z.integer(),
        ownedCount: z.integer(),
        maxCampaigns: z.integer(),
        canCreate: z.boolean(),
      }),
    },
    handler: async ({ user }) => {
      const maxCampaignsPerUser = await this.limits.maxCampaignsPerUser();

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
    use: [$secure({ permissions: ["campaign:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(users.schema),
    },
    handler: async ({ params, user }) => {
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
    use: [$secure({ permissions: ["campaign:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        title: z.string().min(3).max(24).optional(),
        icon: z.uuid().nullable().optional(),
        features: campaignFeaturesSchema.partial().optional(),
        chapterDuration: z.string().nullable().optional(),
        preferredLanguage: z.string().max(8).nullable().optional(),
        // Blights retention window in days (Quest #90). `null` clears the
        // override → the purge cron falls back to the global 30-day default.
        retentionDays: z.integer().min(1).max(3_650).nullable().optional(),
      }),
      response: campaigns.schema,
    },
    handler: async ({ params, body, user }) => {
      const campaign = this.owned.get<Campaign>();

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

      if ("retentionDays" in body) {
        campaign.retentionDays = body.retentionDays ?? undefined;
      }

      if ("preferredLanguage" in body) {
        // Empty string from the client (e.g. the "no preference"
        // sentinel) gets normalized to undefined so MCP can detect
        // "unset" cleanly with a falsy check.
        const lang = body.preferredLanguage?.trim();
        campaign.preferredLanguage = lang ? lang : undefined;
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
    use: [$secure({ permissions: ["campaign:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: campaigns.schema.extend({
        character: characters.schema.optional(),
        quests: z.array(questResourceSchema),
        /**
         * Total number of characters in this campaign (including the
         * viewer). Drives the conditional sidebar reveal of the Roster
         * page — it only appears when the campaign has at least 2.
         */
        characterCount: z.integer(),
      }),
    },
    handler: async ({ params, user }) => {
      const campaign = this.owned.get<Campaign>();

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

      const campaignCharacters = await this.characters.findMany({
        where: { campaignId: { eq: params.id } },
      });

      return {
        ...campaign,
        quests: campaignQuests.map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
        character,
        characterCount: campaignCharacters.length,
      };
    },
  });

  getCampaignCharacters = $action({
    use: [
      $secure({ permissions: ["campaign:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 300 },
      }),
      this.ownsAsMember(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(
        characters.schema.extend({
          user: users.schema,
        }),
      ),
    },
    handler: async ({ params, user }) => {
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
    use: [$secure({ permissions: ["campaign:delete"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
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
      params: z.object({
        id: z.integer(),
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
    use: [$secure({ permissions: ["campaign:read"] }), this.ownsAsMember()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(
        z.object({
          name: z.string(),
          questCount: z.integer(),
          firstQuestAt: z.string().optional(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      const campaign = this.owned.get<Campaign>();

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
    use: [$secure({ permissions: ["campaign:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        oldZoneName: z.string(),
        newZoneName: z.string().min(1),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const campaign = this.owned.get<Campaign>();

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
    use: [$secure({ permissions: ["campaign:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        name: z.string().min(1).max(24),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const campaign = this.owned.get<Campaign>();
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
    use: [$secure({ permissions: ["campaign:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        oldName: z.string(),
        newName: z.string().min(1).max(24),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const campaign = this.owned.get<Campaign>();
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
    use: [$secure({ permissions: ["campaign:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ name: z.string() }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const campaign = this.owned.get<Campaign>();
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
    use: [$secure({ permissions: ["campaign:update"] }), this.ownsAsOwner()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        columns: z.array(z.string()).min(1).max(5),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const campaign = this.owned.get<Campaign>();
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
