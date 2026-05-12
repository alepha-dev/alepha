import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { petitions } from "../entities/petitions.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { questCreateSchema } from "../schemas/questCreateSchema.ts";
import {
  type QuestResource,
  questResourceSchema,
} from "../schemas/questResourceSchema.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

/**
 * Tags matching what TipTap StarterKit + Mantine controls produce.
 */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "mark",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
]);

const sanitizeHtml = (html: string) => {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (match, tag: string) => {
      const lower = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(lower)) return "";
      if (match.startsWith("</")) return `</${lower}>`;
      if (lower === "br" || lower === "hr") return `<${lower}>`;
      return `<${lower}>`;
    });
};

export class QuestController {
  log = $logger();
  quests = $repository(quests);
  campaigns = $repository(campaigns);
  characters = $repository(characters);
  petitions = $repository(petitions);
  characterInfo = $inject(CharacterInfo);
  dt = $inject(DateTimeProvider);
  security = $inject(AppSecurityProvider);
  fileService = $inject(FileService);
  questMapper = $inject(QuestResourceMapper);

  attachments = $bucket({
    maxSize: 10 * 1024 * 1024, // 10 MB
    mimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  });

  /**
   * Enrich a quest entity with computed metadata.
   */
  mapQuestToResource(quest: Quest): QuestResource {
    return this.questMapper.mapQuestToResource(quest);
  }

  createQuest = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      body: questCreateSchema,
      response: questResourceSchema,
    },
    handler: async ({ body, user }) => {
      const { campaign } = await this.security.checkOwnership(
        body.campaignId,
        user,
      );

      // sanitize HTML content
      body.description = sanitizeHtml(body.description);

      if (body.zone && !campaign.zones.includes(body.zone)) {
        campaign.zones.push(body.zone);
        await this.campaigns.updateById(campaign.id, {
          zones: campaign.zones,
        });
      }

      // Validate petition link: must exist in this campaign, must be accepted.
      // Anyone with quest:create can pass any id otherwise, so we check here
      // and not via FK alone.
      if (body.petitionId != null) {
        if (campaign.createdBy !== user.id) {
          throw new ForbiddenError(
            "Only the campaign owner can link a quest to a petition",
          );
        }
        const petition = await this.petitions.findOne({
          where: {
            id: { eq: body.petitionId },
            campaignId: { eq: body.campaignId },
          },
        });
        if (!petition) {
          throw new BadRequestError("Petition not found in this campaign");
        }
        if (petition.status !== "accepted") {
          throw new BadRequestError(
            "Petition must be accepted before quests can be linked",
          );
        }
      }

      const quest = await this.quests.create({
        ...body,
        attachments: body.attachments ?? [],
        createdBy: user.id,
        history: [],
      });

      return this.mapQuestToResource(quest);
    },
  });

  uploadAttachment = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    path: "/quests/attachments",
    schema: {
      body: t.object({
        file: t.file(),
      }),
      response: t.object({
        fileId: t.uuid(),
        url: t.string(),
      }),
    },
    handler: async ({ body, user }) => {
      const file = await this.fileService.uploadFile(body.file, {
        user,
        bucket: this.attachments.name,
      });
      return {
        fileId: file.id,
        url: `/api/files/${file.id}`,
      };
    },
  });

  addAttachment = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        fileId: t.uuid(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      if (quest.attachments.includes(body.fileId)) {
        return this.mapQuestToResource(quest);
      }

      const updated = await this.quests.updateById(params.id, {
        attachments: [...quest.attachments, body.fileId],
      });

      return this.mapQuestToResource(updated);
    },
  });

  removeAttachment = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
        fileId: t.uuid(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      const updatedAttachments = quest.attachments.filter(
        (id) => id !== params.fileId,
      );

      // Delete the file from storage
      await this.fileService.deleteFile(params.fileId).catch(() => {
        // File may not exist or already deleted
      });

      const updated = await this.quests.updateById(params.id, {
        attachments: updatedAttachments,
      });

      return this.mapQuestToResource(updated);
    },
  });

  getQuests = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: t.object({
        campaignId: t.integer(),
      }),
      query: t.extend(pageQuerySchema, {
        status: t.optional(t.enum(["new", "accepted", "completed"])),
        search: t.optional(t.string()),
        chapterId: t.optional(t.integer()),
        zone: t.optional(t.string()),
      }),
      response: db.page(questResourceSchema),
    },
    handler: async ({ params, query, user }) => {
      await this.security.checkOwnership(params.campaignId, user);

      const where = this.quests.createQueryWhere();
      where.campaignId = { eq: params.campaignId };

      if (query.search) {
        where.title = { ilike: `%${query.search}%` };
      }

      if (query.chapterId) {
        where.chapterId = { eq: query.chapterId };
      }

      if (query.zone) {
        where.zone = { eq: query.zone };
      }

      if (query.status === "new") {
        where.acceptedAt = { isNull: true };
        where.completedAt = { isNull: true };
      } else if (query.status === "accepted") {
        where.acceptedAt = { isNotNull: true };
        where.completedAt = { isNull: true };
      } else if (query.status === "completed") {
        where.completedAt = { isNotNull: true };
        query.sort ??= "-completedAt";
      }

      query.sort ??= "-updatedAt";

      const result = await this.quests.paginate(
        query,
        {
          where,
        },
        { count: true },
      );

      return {
        ...result,
        content: result.content.map((quest) => this.mapQuestToResource(quest)),
      };
    },
  });

  abandonQuest = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      quest.acceptedAt = undefined;
      quest.acceptedBy = undefined;
      quest.kanbanColumn = undefined;
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "unassigned",
      });

      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  acceptQuest = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNull: true },
          completedAt: { isNull: true },
        },
      });

      const { campaign } = await this.security.checkOwnership(
        quest.campaignId,
        user,
      );

      quest.acceptedAt = this.dt.nowISOString();
      quest.acceptedBy = user.id;
      // When kanban is on, drop the freshly-accepted quest into the first
      // configured sub-column so it has a place to live on the board.
      if (campaign.features?.kanban) {
        quest.kanbanColumn = campaign.kanbanColumns?.[0];
      }
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "assigned",
      });

      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  setQuestKanbanColumn = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        kanbanColumn: t.string(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });
      const { campaign } = await this.security.checkOwnership(
        quest.campaignId,
        user,
      );
      const columns = campaign.kanbanColumns ?? [];
      if (!columns.includes(body.kanbanColumn)) {
        throw new BadRequestError("Unknown kanban column for this campaign.");
      }
      quest.kanbanColumn = body.kanbanColumn;
      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  completeQuest = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.extend(questResourceSchema, {
        character: characters.schema,
      }),
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
          acceptedAt: { isNotNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      // Check if all objectives are completed
      if (quest.objectives.length > 0) {
        const incompleteObjectives = quest.objectives.filter(
          (obj) => !obj.completed,
        );
        if (incompleteObjectives.length > 0) {
          throw new BadRequestError(
            `Cannot complete quest: ${incompleteObjectives.length} objective(s) remain incomplete`,
          );
        }
      }

      const character = await this.characters.getOne({
        where: {
          campaignId: { eq: quest.campaignId },
          userId: { eq: user.id },
        },
      });

      const xp = this.characterInfo.getXpFromQuest(quest);
      const money = this.characterInfo.getMoneyFromQuest(quest);

      character.xp += xp;
      character.balance += money;
      quest.completedAt = this.dt.nowISOString();
      quest.completedBy = user.id;
      quest.kanbanColumn = undefined;

      await Promise.all([
        this.characters.save(character),
        this.quests.save(quest),
      ]);

      return {
        ...this.mapQuestToResource(quest),
        character,
      };
    },
  });

  getQuestById = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      return this.mapQuestToResource(quest);
    },
  });

  updateQuestById = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.partial(
        t.pick(quests.schema, [
          "title",
          "description",
          "zone",
          "difficulty",
          "priority",
          "objectives",
          "attachments",
        ]),
      ),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      const { campaign } = await this.security.checkOwnership(
        quest.campaignId,
        user,
      );

      if (quest.createdBy !== user.id && campaign.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can edit this quest",
        );
      }

      if (body.description) {
        // sanitize HTML content
        body.description = sanitizeHtml(body.description);
      }

      const updated = await this.quests.updateById(params.id, {
        ...body,
        history: [
          ...quest.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ],
      });

      return this.mapQuestToResource(updated);
    },
  });

  completeObjective = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        index: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user, body }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
          acceptedAt: { isNotNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      if (body.index < 0 || body.index >= quest.objectives.length) {
        throw new BadRequestError("Invalid objective index");
      }

      // Mark the specific objective as completed
      quest.objectives[body.index].completed =
        !quest.objectives[body.index].completed;

      const updated = await this.quests.updateById(params.id, {
        objectives: quest.objectives,
        history: quest.objectives[body.index].completed
          ? [
              ...quest.history,
              {
                at: this.dt.nowISOString(),
                by: user.id,
                action: "objective_completed",
              },
            ]
          : quest.history,
      });

      return this.mapQuestToResource(updated);
    },
  });

  updateQuestObjectives = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        objectives: t.array(
          t.object({
            title: t.string(),
            completed: t.boolean(),
          }),
        ),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      const { campaign } = await this.security.checkOwnership(
        quest.campaignId,
        user,
      );

      if (quest.createdBy !== user.id && campaign.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can edit objectives",
        );
      }

      const updated = await this.quests.updateById(params.id, {
        objectives: body.objectives,
        history: [
          ...quest.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ],
      });

      return this.mapQuestToResource(updated);
    },
  });

  deleteQuest = $action({
    use: [$secure({ permissions: ["quest:delete"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
        },
      });

      const { campaign } = await this.security.checkOwnership(
        quest.campaignId,
        user,
      );

      if (quest.createdBy !== user.id && campaign.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can delete this quest",
        );
      }

      await this.quests.deleteById(params.id);

      return { ok: true };
    },
  });

  moveQuestToZone = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        newZone: t.string(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      // Update the quest's zone (zone)
      const updatedQuest = await this.quests.updateById(params.id, {
        zone: body.newZone,
        history: [
          ...quest.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ],
      });

      // Ensure the new zone exists in the campaign's zones list
      const campaign = await this.campaigns.getById(quest.campaignId);
      if (!campaign.zones.includes(body.newZone)) {
        await this.campaigns.updateById(campaign.id, {
          zones: [...campaign.zones, body.newZone],
        });
      }

      return this.mapQuestToResource(updatedQuest);
    },
  });

  updateQuestNote = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        note: t.string({ size: "rich" }),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      // sanitize HTML content
      const sanitizedNote = sanitizeHtml(body.note);

      const updated = await this.quests.updateById(params.id, {
        note: sanitizedNote,
      });

      return this.mapQuestToResource(updated);
    },
  });

  startTimer = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      // Check if timer is already running (last session has no stoppedAt)
      const sessions = quest.timerSessions || [];
      const lastSession = sessions[sessions.length - 1];
      if (lastSession && !lastSession.stoppedAt) {
        throw new BadRequestError("Timer is already running");
      }

      // Add new timer session
      sessions.push({
        startedAt: this.dt.nowISOString(),
      });

      const updated = await this.quests.updateById(params.id, {
        timerSessions: sessions,
      });

      return this.mapQuestToResource(updated);
    },
  });

  stopTimer = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(quest.campaignId, user);

      // Find the running timer session
      const sessions = quest.timerSessions || [];
      const lastSession = sessions[sessions.length - 1];
      if (!lastSession || lastSession.stoppedAt) {
        throw new BadRequestError("No timer is running");
      }

      // Stop the timer
      lastSession.stoppedAt = this.dt.nowISOString();

      const updated = await this.quests.updateById(params.id, {
        timerSessions: sessions,
      });

      return this.mapQuestToResource(updated);
    },
  });
}
