import { $inject, z } from "alepha";
import { FileService } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, $transactional, db, pageQuerySchema } from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { type Campaign, campaigns } from "../entities/campaigns.ts";
import { characters } from "../entities/characters.ts";
import { petitions } from "../entities/petitions.ts";
import {
  normalizeQuestTags,
  type Quest,
  quests,
  REMINDER_INTERVAL_MS,
  REMINDER_INTERVAL_VALUES,
} from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { questCreateSchema } from "../schemas/questCreateSchema.ts";
import {
  type QuestResource,
  type QuestStatus,
  questResourceSchema,
  questStatusSchema,
} from "../schemas/questResourceSchema.ts";
import { AchievementEngine } from "../services/AchievementEngine.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";
import { QuestService, sanitizeHtml } from "../services/QuestService.ts";

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
  achievements = $inject(AchievementEngine);
  questService = $inject(QuestService);

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
   * Load a quest for a state-changing endpoint, asserting membership and
   * the lifecycle precondition separately so each failure gets its own
   * answer.
   *
   * These handlers used to fold the precondition into the `getOne`
   * where-clause (`acceptedAt: { isNotNull: true }`, …). A quest in the
   * wrong state then matched no row and came back as the ORM's
   * `DbEntityNotFoundError` — "Entity from 'quests' was not found" — which
   * says nothing about what to do next. MCP agents hit this constantly:
   * `quest_complete` on a quest still in "new" reported the quest as
   * missing when the real answer was "accept it first".
   *
   * Fetching by id keeps 404 honest and turns a precondition failure into
   * a 400 naming both the current status and the required one. Membership
   * is asserted before the status is revealed, so a non-member still
   * learns nothing about the quest beyond its existence — same as before.
   */
  protected async getQuestForTransition(
    id: number,
    user: UserAccountToken,
    action: string,
    allowed: QuestStatus[],
  ): Promise<{ quest: Quest; campaign: Campaign }> {
    const quest = await this.quests.getOne({ where: { id: { eq: id } } });
    const { campaign } = await this.security.assertMember(
      quest.campaignId,
      user,
    );

    const status = this.questMapper.questStatus(quest);
    if (!allowed.includes(status)) {
      const expected = allowed.map((s) => `"${s}"`).join(" or ");
      throw new BadRequestError(
        `Cannot ${action} quest #${quest.shortId}: it is "${status}", expected ${expected}.`,
      );
    }

    return { quest, campaign };
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
    return this.questService.ensureObjectiveIds(objectives);
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

      // Validate optional `dependsOn` — must be in the same campaign and
      // cannot point at the quest itself (we don't have the shortId yet,
      // so the self-check fires on update). NULL-by-default schema means
      // `dependsOn: null` from the client clears the link.
      if (body.dependsOn != null) {
        const predecessor = await this.quests.findOne({
          where: {
            id: { eq: body.dependsOn },
            campaignId: { eq: body.campaignId },
          },
        });
        if (!predecessor) {
          throw new BadRequestError(
            "dependsOn quest not found in this campaign",
          );
        }
      }

      // Quest-creation mechanics (shortId sequence, zone-ensure, HTML
      // sanitization, defaults) live in QuestService — the single path
      // shared with BlightController.forwardBlightToQuest.
      const quest = await this.questService.createQuest(campaign, {
        campaignId: body.campaignId,
        title: body.title,
        // Title-only quests are allowed; default the optional description to
        // "" so the NOT-NULL column + sanitizeHtml never see undefined.
        description: body.description ?? "",
        zone: body.zone,
        priority: body.priority,
        difficulty: body.difficulty,
        // `z.nullable` skips the schema's `minimum: 1`, so guard here: a
        // non-positive estimate is stored as none (the UI can't produce it).
        estimateMinutes:
          body.estimateMinutes && body.estimateMinutes > 0
            ? body.estimateMinutes
            : undefined,
        objectives: body.objectives,
        attachments: body.attachments,
        tags: body.tags,
        dependsOn: body.dependsOn,
        petitionId: body.petitionId,
        createdBy: user.id,
      });

      return this.mapQuestToResource(quest);
    },
  });

  uploadAttachment = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    path: "/quests/attachments",
    schema: {
      body: z.object({
        file: z.file(),
      }),
      response: z.object({
        fileId: z.uuid(),
        url: z.string(),
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
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        fileId: z.uuid(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "attach a file to",
        ["new", "accepted", "shelved"],
      );

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
      params: z.object({
        id: z.integer(),
        fileId: z.uuid(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "remove an attachment from",
        ["new", "accepted", "shelved"],
      );

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
      params: z.object({
        campaignId: z.integer(),
      }),
      query: pageQuerySchema.extend({
        status: questStatusSchema.optional(),
        search: z.string().optional(),
        chapterId: z.integer().optional(),
        zone: z.string().optional(),
        tag: z.string().optional(),
      }),
      response: db.page(questResourceSchema),
    },
    handler: async ({ params, query, user }) => {
      await this.security.assertMember(params.campaignId, user);

      const where = this.quests.createQueryWhere();
      where.campaignId = { eq: params.campaignId };

      if (query.search) {
        // ID-by-search: a bare integer or `#N` form means "find this
        // specific quest by its per-campaign shortId" (Lore #94 — UX
        // shortcut for typing #42 into the same search box). Anything
        // else stays title `ilike`.
        const idMatch = query.search.trim().match(/^#?(\d+)$/);
        if (idMatch) {
          where.shortId = { eq: Number.parseInt(idMatch[1], 10) };
        } else {
          where.title = { ilike: `%${query.search}%` };
        }
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
        where.shelvedAt = { isNull: true };
      } else if (query.status === "accepted") {
        where.acceptedAt = { isNotNull: true };
        where.completedAt = { isNull: true };
      } else if (query.status === "completed") {
        where.completedAt = { isNotNull: true };
        query.sort ??= "-completedAt";
      } else if (query.status === "shelved") {
        where.shelvedAt = { isNotNull: true };
        query.sort ??= "-shelvedAt";
      } else {
        // No status filter means "everything I still care about" — shelved
        // quests are deliberately out of scope, so they only ever surface
        // through the explicit `shelved` filter.
        where.shelvedAt = { isNull: true };
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
   * Questline data for a single quest — the predecessor it depends on
   * (if any) and the quests that depend on it. Surfaces a "Blocked by"
   * badge and an "Unlocks" backlink in the UI; agents can read it via
   * `quest_get` (predecessor is `dependsOn_shortId`; dependents are
   * exposed there only in aggregate via separate calls).
   */
  /**
   * Lightweight per-campaign edge list for the dependency-graph page
   * (Lore #98). Returns just `{ id, shortId, title, status, dependsOn }`
   * for every quest in the campaign — small enough to keep in the
   * client and BFS-walk to compute an epic component without burning
   * the full QuestResource pagination.
   */
  getDependencyGraph = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    path: "/campaigns/:campaignId/quests/graph",
    schema: {
      params: z.object({ campaignId: z.integer() }),
      response: z.array(
        z.object({
          id: z.integer(),
          shortId: z.integer(),
          title: z.string(),
          status: questStatusSchema,
          dependsOn: z.integer().optional(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);
      const rows = await this.quests.findMany({
        where: { campaignId: { eq: params.campaignId } },
        columns: [
          "id",
          "shortId",
          "title",
          "acceptedAt",
          "completedAt",
          "shelvedAt",
          "dependsOn",
        ],
      });
      return rows.map((q) => ({
        id: q.id,
        shortId: q.shortId,
        title: q.title,
        status: (q.completedAt
          ? "completed"
          : q.acceptedAt
            ? "accepted"
            : q.shelvedAt
              ? "shelved"
              : "new") as "new" | "accepted" | "completed" | "shelved",
        dependsOn: q.dependsOn ?? undefined,
      }));
    },
  });

  getQuestLine = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      response: z.object({
        predecessor: z
          .object({
            id: z.integer(),
            shortId: z.integer(),
            title: z.string(),
            completedAt: z.datetime().optional(),
            shelvedAt: z.datetime().optional(),
          })
          .optional(),
        dependents: z.array(
          z.object({
            id: z.integer(),
            shortId: z.integer(),
            title: z.string(),
            completedAt: z.datetime().optional(),
            shelvedAt: z.datetime().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params, user }) => {
      const quest = await this.quests.getOne({
        where: { id: { eq: params.id } },
      });
      await this.security.assertMember(quest.campaignId, user);

      const [predecessor, dependents] = await Promise.all([
        quest.dependsOn != null
          ? this.quests.findOne({
              where: { id: { eq: quest.dependsOn } },
            })
          : Promise.resolve(undefined),
        this.quests.findMany({
          where: { dependsOn: { eq: params.id } },
        }),
      ]);

      return {
        predecessor: predecessor
          ? {
              id: predecessor.id,
              shortId: predecessor.shortId,
              title: predecessor.title,
              completedAt: predecessor.completedAt,
              shelvedAt: predecessor.shelvedAt,
            }
          : undefined,
        dependents: dependents.map((d) => ({
          id: d.id,
          shortId: d.shortId,
          title: d.title,
          completedAt: d.completedAt,
          shelvedAt: d.shelvedAt,
        })),
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
      query: z.object({ campaignId: z.integer() }),
      response: z.array(z.string()),
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
    use: [$secure({ permissions: ["quest:update"] }), $transactional()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "abandon",
        ["accepted"],
      );

      quest.acceptedAt = undefined;
      quest.acceptedBy = undefined;
      quest.kanbanColumn = undefined;
      // Reminders are tied to the assignee — clear when the quest is
      // abandoned so the sweep doesn't keep emailing an absent owner.
      quest.reminderInterval = undefined;
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

  /**
   * Set a quest aside as out of scope without deleting it. Shelved quests
   * drop out of the default quest list and out of progress/stats
   * denominators — the backlog stops showing work nobody intends to do
   * right now, but the idea survives.
   *
   * Only quests still in "new" status can be shelved: an accepted quest
   * must be abandoned first, so that clearing the assignee, timer and
   * reminders stays an explicit act rather than a side-effect of shelving.
   */
  shelveQuest = $action({
    use: [$secure({ permissions: ["quest:update"] }), $transactional()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      // "shelved" is allowed so re-shelving stays idempotent below.
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "shelve",
        ["new", "shelved"],
      );

      if (quest.shelvedAt) {
        return this.mapQuestToResource(quest);
      }

      quest.shelvedAt = this.dt.nowISOString();
      quest.shelvedBy = user.id;
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "shelved",
      });

      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  /**
   * Bring a shelved quest back into the backlog as "new".
   */
  unshelveQuest = $action({
    use: [$secure({ permissions: ["quest:update"] }), $transactional()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "unshelve",
        ["shelved"],
      );

      quest.shelvedAt = undefined;
      quest.shelvedBy = undefined;
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "unshelved",
      });

      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  acceptQuest = $action({
    use: [$secure({ permissions: ["quest:update"] }), $transactional()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      // "shelved" is allowed on purpose — see the un-shelving branch below.
      const { quest, campaign } = await this.getQuestForTransition(
        params.id,
        user,
        "accept",
        ["new", "shelved"],
      );

      // Questline gate (Lore #32): refuse to accept while a non-null
      // predecessor is still in flight. The dependent quest stays
      // visible in the "new" lane — the UI flips its badge to
      // "Unblocked" once the predecessor completes.
      if (quest.dependsOn != null) {
        const predecessor = await this.quests.findOne({
          where: { id: { eq: quest.dependsOn } },
        });
        if (predecessor && !predecessor.completedAt) {
          throw new BadRequestError(
            `Cannot accept quest: blocked by #${predecessor.shortId}`,
          );
        }
      }

      quest.acceptedAt = this.dt.nowISOString();
      quest.acceptedBy = user.id;
      // Accepting is a stronger signal than shelving: pick up a shelved
      // quest and it simply comes back off the shelf, rather than erroring
      // out and demanding an explicit unshelve first.
      if (quest.shelvedAt) {
        quest.shelvedAt = undefined;
        quest.shelvedBy = undefined;
        quest.history.push({
          at: this.dt.nowISOString(),
          by: user.id,
          action: "unshelved",
        });
      }
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
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        kanbanColumn: z.string(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest, campaign } = await this.getQuestForTransition(
        params.id,
        user,
        "move",
        ["accepted"],
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
   * nudge, not a campaign-wide notification. `interval: null` clears
   * any existing reminder; passing a preset schedules the next send
   * at `now + REMINDER_INTERVAL_MS[interval]` and the `QuestJobs`
   * nightly sweep advances from there.
   */
  setQuestReminder = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        interval: z
          .enum(REMINDER_INTERVAL_VALUES)
          .meta({ mode: "text" })
          .nullable(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest, campaign } = await this.getQuestForTransition(
        params.id,
        user,
        "set a reminder on",
        ["accepted"],
      );

      if (quest.acceptedBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest's assignee can set its reminder",
        );
      }

      // Reminders are an owner-controlled module toggle. Disabling
      // (interval=null) is always allowed so a campaign that turned the
      // module off can still clear pre-existing reminders.
      if (body.interval != null && !campaign.features?.questReminder) {
        throw new ForbiddenError(
          "Quest Reminder is disabled for this campaign.",
        );
      }

      if (body.interval == null) {
        quest.reminderInterval = undefined;
        quest.reminderNextAt = undefined;
      } else {
        quest.reminderInterval = body.interval;
        quest.reminderNextAt = new Date(
          this.dt.nowMillis() + REMINDER_INTERVAL_MS[body.interval],
        ).toISOString();
      }
      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  completeQuest = $action({
    // Writes `quests` then `characters` (award + achievements). Without the
    // transaction a failed character save leaves the quest closed and the
    // reward silently dropped, and two concurrent completions both pass the
    // `completedAt IS NULL` read and double-award.
    use: [$secure({ permissions: ["quest:update"] }), $transactional()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        /**
         * Optional summary of what was actually done to close the quest.
         * Stored on the quest row, surfaced in the UI completed-state and
         * exposed to LLM agents via MCP. Write-once: only persisted on the
         * accepted → completed transition.
         */
        message: z.string().meta({ size: "rich" }).optional(),
      }),
      response: questResourceSchema.extend({
        character: characters.schema,
        /**
         * XP and money awarded by THIS completion. Distinct from
         * `character.xp` / `character.balance`, which are lifetime
         * accumulators — MCP `quest_complete` used to report the
         * accumulators as the per-quest award.
         */
        xpEarned: z.integer(),
        moneyEarned: z.integer(),
      }),
    },
    handler: async ({ params, body, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "complete",
        ["accepted"],
      );

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
      quest.reminderInterval = undefined;
      quest.reminderNextAt = undefined;
      const message = body?.message?.trim();
      if (message) {
        quest.completionMessage = message;
        quest.completionMessageUpdatedAt = quest.completedAt;
      }

      // Persist the quest first so the achievement predicates (which COUNT
      // completed quests) see the row we just transitioned. Character is
      // saved after, with any newly-granted achievements folded in.
      await this.quests.save(quest);

      const campaign = await this.campaigns.getOne({
        where: { id: { eq: quest.campaignId } },
      });
      const newAchievements = await this.achievements.evaluate(
        { type: "quest.completed" },
        {
          character,
          campaignZones: campaign.zones ?? [],
        },
      );
      if (newAchievements.length > 0) {
        character.achievements = this.achievements.grant(
          character,
          newAchievements,
        );
      }

      await this.characters.save(character);

      return {
        ...this.mapQuestToResource(quest),
        character,
        xpEarned: xp,
        moneyEarned: money,
      };
    },
  });

  getQuestById = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: z.object({
        id: z.integer(),
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
      params: z.object({
        campaignId: z.integer(),
        shortId: z.integer(),
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
      params: z.object({
        id: z.integer(),
      }),
      body: quests.schema
        .pick({
          title: true,
          description: true,
          zone: true,
          difficulty: true,
          priority: true,
          objectives: true,
          attachments: true,
          completionMessage: true,
          tags: true,
        })
        .partial()
        .extend({
          // `dependsOn` is special-cased: `null` clears the link, integer
          // sets it. Picking from the entity schema would emit
          // `optional<integer>` only, dropping the explicit-clear path.
          dependsOn: z.integer().nullable().optional(),
          // `petitionId` links this quest back to an accepted petition (what
          // the petition inbox's "linked quests" reads). `null` clears the
          // link; integer sets it. Owner-only + accepted-petition checks in
          // the handler, mirroring `createQuest`.
          petitionId: z.integer().nullable().optional(),
          // Optional time estimate (minutes). `null` clears the column,
          // integer sets it; the generic `patch = { ...body }` spread below
          // applies it as-is (set / clear / leave-unchanged).
          estimateMinutes: z.integer().min(1).nullable().optional(),
        }),
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
      if (body.dependsOn !== undefined) {
        if (body.dependsOn === null) {
          // `null` (not `undefined`) so updateById actually clears the column —
          // an undefined patch value is treated as "leave unchanged".
          patch.dependsOn = null;
        } else {
          if (body.dependsOn === quest.id) {
            throw new BadRequestError("A quest cannot depend on itself");
          }
          const predecessor = await this.quests.findOne({
            where: {
              id: { eq: body.dependsOn },
              campaignId: { eq: quest.campaignId },
            },
          });
          if (!predecessor) {
            throw new BadRequestError(
              "dependsOn quest not found in this campaign",
            );
          }
          patch.dependsOn = body.dependsOn;
        }
      }
      // Link / unlink a petition. Same guard as `createQuest`: only the
      // campaign owner may link, and only to a petition that exists in this
      // campaign and is already accepted. `null` clears the link.
      if (body.petitionId !== undefined) {
        if (body.petitionId === null) {
          patch.petitionId = null;
        } else {
          if (campaign.createdBy !== user.id) {
            throw new ForbiddenError(
              "Only the campaign owner can link a quest to a petition",
            );
          }
          const petition = await this.petitions.findOne({
            where: {
              id: { eq: body.petitionId },
              campaignId: { eq: quest.campaignId },
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
          patch.petitionId = body.petitionId;
        }
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
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        /**
         * Per-quest objective id (see `ensureObjectiveIds`). The UI gets
         * these ids back from `mapQuestToResource` — legacy quests are
         * lazily normalized so this value is always defined client-side.
         */
        objectiveId: z.integer().min(0),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user, body }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "tick an objective on",
        ["accepted"],
      );

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
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        objectives: z.array(
          z.object({
            title: z.string(),
            completed: z.boolean(),
          }),
        ),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest, campaign } = await this.getQuestForTransition(
        params.id,
        user,
        "edit the objectives of",
        ["new", "accepted", "shelved"],
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
      params: z.object({
        id: z.integer(),
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

      // Clear dependents' `dependsOn` before the row is removed — the FK
      // emitted by Drizzle's `ALTER TABLE ADD COLUMN REFERENCES` lacks
      // an explicit `ON DELETE SET NULL` clause (SQLite ALTER quirk),
      // so D1 would refuse the delete if any dependent still pointed at
      // this id. Mirror the folio-parent pattern.
      const dependents = await this.quests.findMany({
        where: { dependsOn: { eq: params.id } },
        columns: ["id"],
      });
      for (const dep of dependents) {
        await this.quests.updateById(dep.id, { dependsOn: undefined });
      }

      await this.quests.deleteById(params.id);

      return { ok: true };
    },
  });

  moveQuestToZone = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        newZone: z.string(),
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
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        note: z.string().meta({ size: "rich" }),
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
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "start a timer on",
        ["accepted"],
      );

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
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = await this.getQuestForTransition(
        params.id,
        user,
        "stop a timer on",
        ["accepted"],
      );

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
