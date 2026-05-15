import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  $repository,
  $sequence,
  $transactional,
  db,
  pageQuerySchema,
} from "alepha/orm";
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
import { normalizeQuestTags, type Quest, quests } from "../entities/quests.ts";
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

  /**
   * Per-campaign sequence for `quests.shortId`. Advances inside the
   * `$transactional` block on create, so failed inserts return the id to
   * the pool instead of burning it.
   */
  protected questShortId = $sequence();

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

  /**
   * Backfill / generate stable `id` for each objective in the array.
   * - Legacy objectives (`id == null` across the board): assign by current
   *   index — deterministic, matches what the mapper synthesizes on read so
   *   history entries keyed by that id stay valid.
   * - Mixed sets (some have ids, new ones don't): preserve existing ids,
   *   assign `max(existing) + 1, +2, ...` to the ones missing one.
   *
   * Persisted on every write that touches `objectives` so the next read
   * sees real ids and the synthesis becomes a no-op.
   */
  protected ensureObjectiveIds(
    objectives: Quest["objectives"],
  ): Quest["objectives"] {
    const used = new Set<number>();
    for (const o of objectives) if (o.id != null) used.add(o.id);
    // For a fully legacy set we want id === index so backfilled history
    // entries stay coherent with the mapper's synthesis path.
    const legacy = used.size === 0;
    let nextFreeId = used.size > 0 ? Math.max(...used) + 1 : 0;
    return objectives.map((obj, index) => {
      if (obj.id != null) return obj;
      if (legacy) {
        used.add(index);
        return { ...obj, id: index };
      }
      while (used.has(nextFreeId)) nextFreeId++;
      const id = nextFreeId++;
      used.add(id);
      return { ...obj, id };
    });
  }

  createQuest = $action({
    use: [$secure({ permissions: ["quest:create"] }), $transactional()],
    schema: {
      body: questCreateSchema,
      response: questResourceSchema,
    },
    handler: async ({ body, user }) => {
      const { campaign } = await this.security.assertMember(
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

      const shortId = await this.questShortId.next(String(body.campaignId));

      const quest = await this.quests.create({
        ...body,
        shortId,
        attachments: body.attachments ?? [],
        tags: normalizeQuestTags(body.tags ?? []),
        objectives: this.ensureObjectiveIds(body.objectives ?? []),
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

      await this.security.assertMember(quest.campaignId, user);

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

      await this.security.assertMember(quest.campaignId, user);

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
        tag: t.optional(t.string()),
      }),
      response: db.page(questResourceSchema),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.campaignId, user);

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

      if (query.tag) {
        // tags are stored as a JSON array; LIKE the serialized form
        // matches an exact (normalized) value. Mirrors folio tag search.
        where.tags = { like: `%"${query.tag.toLowerCase()}"%` };
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

  /**
   * Return the distinct set of tags used by any quest in a campaign —
   * fuel for chip autocomplete in the editor and the filter dropdown.
   * Mirrors `FolioController.listTags` but scope is campaign-level (tags
   * are a property of the campaign's quest taxonomy, not the user's).
   */
  listQuestTags = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    description: "Return the distinct set of tags used in a campaign.",
    schema: {
      query: t.object({ campaignId: t.integer() }),
      response: t.array(t.string()),
    },
    handler: async ({ query, user }) => {
      await this.security.assertMember(query.campaignId, user);
      const rows = await this.quests.findMany({
        where: { campaignId: { eq: query.campaignId } },
        columns: ["tags"],
      });
      const tags = new Set<string>();
      for (const row of rows) {
        for (const tag of row.tags ?? []) tags.add(tag);
      }
      return [...tags].sort();
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

      await this.security.assertMember(quest.campaignId, user);

      quest.acceptedAt = undefined;
      quest.acceptedBy = undefined;
      quest.kanbanColumn = undefined;
      // Reminders are tied to the assignee — clear when the quest is
      // abandoned so the sweep doesn't keep emailing an absent owner.
      quest.reminderIntervalMs = undefined;
      quest.reminderNextAt = undefined;
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

      const { campaign } = await this.security.assertMember(
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
      const { campaign } = await this.security.assertMember(
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

  /**
   * Configure (or clear) the periodic reminder for an accepted quest.
   * Only the assignee can set their own reminder — it's a per-user
   * nudge, not a campaign-wide notification. `intervalMs: null` clears
   * any existing reminder; passing a number schedules the next send
   * at `now + intervalMs` and the `QuestJobs` sweep advances from
   * there.
   */
  setQuestReminder = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        intervalMs: t.nullable(t.integer({ minimum: 60_000 })),
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

      await this.security.assertMember(quest.campaignId, user);

      if (quest.acceptedBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest's assignee can set its reminder",
        );
      }

      if (body.intervalMs == null) {
        quest.reminderIntervalMs = undefined;
        quest.reminderNextAt = undefined;
      } else {
        quest.reminderIntervalMs = body.intervalMs;
        quest.reminderNextAt = new Date(
          this.dt.nowMillis() + body.intervalMs,
        ).toISOString();
      }
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
      body: t.object({
        /**
         * Optional summary of what was actually done to close the quest.
         * Stored on the quest row, surfaced in the UI completed-state and
         * exposed to LLM agents via MCP. Write-once: only persisted on the
         * accepted → completed transition.
         */
        message: t.optional(t.string({ size: "rich" })),
      }),
      response: t.extend(questResourceSchema, {
        character: characters.schema,
      }),
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
          acceptedAt: { isNotNull: true },
        },
      });

      await this.security.assertMember(quest.campaignId, user);

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
      // Reminders auto-stop when the quest is done (see Lore #42).
      quest.reminderIntervalMs = undefined;
      quest.reminderNextAt = undefined;
      const message = body?.message?.trim();
      if (message) {
        quest.completionMessage = message;
        quest.completionMessageUpdatedAt = quest.completedAt;
      }

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

      await this.security.assertMember(quest.campaignId, user);

      return this.mapQuestToResource(quest);
    },
  });

  getQuestByShortId = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    path: "/campaigns/:campaignId/quests/:shortId",
    schema: {
      params: t.object({
        campaignId: t.integer(),
        shortId: t.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: {
          campaignId: { eq: params.campaignId },
          shortId: { eq: params.shortId },
        },
      });

      await this.security.assertMember(quest.campaignId, user);

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
          "completionMessage",
          "tags",
        ]),
      ),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getOne({
        where: { id: { eq: params.id } },
      });

      const { campaign } = await this.security.assertMember(
        quest.campaignId,
        user,
      );

      if (quest.createdBy !== user.id && campaign.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can edit this quest",
        );
      }

      // On completed quests the only field that can be revised is the
      // completion summary — campaign memory is curatable, but the quest
      // body (title/description/objectives/…) stays frozen as an audit
      // record of what was closed.
      if (quest.completedAt) {
        const otherEdits = Object.entries(body).filter(
          ([key, value]) => key !== "completionMessage" && value !== undefined,
        );
        if (otherEdits.length > 0) {
          throw new BadRequestError(
            "Only completionMessage can be edited on a completed quest",
          );
        }
      }

      if (body.description) {
        // sanitize HTML content
        body.description = sanitizeHtml(body.description);
      }

      const patch: Record<string, unknown> = { ...body };
      if (body.tags !== undefined) {
        patch.tags = normalizeQuestTags(body.tags);
      }
      if (
        body.completionMessage !== undefined &&
        body.completionMessage !== quest.completionMessage
      ) {
        patch.completionMessageUpdatedAt = this.dt.nowISOString();
      }
      // Don't append a "updated" history entry on a completed quest — we
      // only allow the summary edit, the rest of the quest is frozen.
      if (!quest.completedAt) {
        patch.history = [
          ...quest.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ];
      }

      const updated = await this.quests.updateById(params.id, patch);

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
        /**
         * Per-quest objective id (see `ensureObjectiveIds`). The UI gets
         * these ids back from `mapQuestToResource` — legacy quests are
         * lazily normalized so this value is always defined client-side.
         */
        objectiveId: t.integer({ minimum: 0 }),
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

      await this.security.assertMember(quest.campaignId, user);

      // Backfill ids for legacy rows before the lookup — preserves the
      // controller's invariant that anything we read out of `objectives`
      // also goes back in with stable ids on the write below.
      const objectives = this.ensureObjectiveIds(quest.objectives);
      const target = objectives.find((o) => o.id === body.objectiveId);
      if (!target) {
        throw new BadRequestError("Objective not found");
      }
      target.completed = !target.completed;

      // Manage history: tick → append; untick → drop the matching entry
      // (this is the fix for quest #23 "History Spam"). For untick we
      // remove all matching rows, not just the most recent one, in case a
      // legacy state somehow accumulated duplicates.
      const history = target.completed
        ? [
            ...quest.history,
            {
              at: this.dt.nowISOString(),
              by: user.id,
              action: "objective_completed" as const,
              objectiveId: target.id,
            },
          ]
        : quest.history.filter(
            (h) =>
              !(
                h.action === "objective_completed" &&
                h.objectiveId === target.id
              ),
          );

      const updated = await this.quests.updateById(params.id, {
        objectives,
        history,
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

      const { campaign } = await this.security.assertMember(
        quest.campaignId,
        user,
      );

      if (quest.createdBy !== user.id && campaign.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can edit objectives",
        );
      }

      const updated = await this.quests.updateById(params.id, {
        objectives: this.ensureObjectiveIds(body.objectives),
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

      const { campaign } = await this.security.assertMember(
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

      await this.security.assertMember(quest.campaignId, user);

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

      await this.security.assertMember(quest.campaignId, user);

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

      await this.security.assertMember(quest.campaignId, user);

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

      await this.security.assertMember(quest.campaignId, user);

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
