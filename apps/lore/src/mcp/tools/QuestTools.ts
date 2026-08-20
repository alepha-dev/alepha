import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { EpicController } from "../../api/controllers/EpicController.ts";
import { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { QuestCommentController } from "../../api/controllers/QuestCommentController.ts";
import { QuestController } from "../../api/controllers/QuestController.ts";
import type { EpicResource } from "../../api/schemas/epicResourceSchema.ts";
import type { QuestStatus } from "../../api/schemas/questResourceSchema.ts";
import { QuestResourceMapper } from "../../api/services/QuestResourceMapper.ts";
// Same helper the UI labels a user with, so a name reads identically over
// MCP and on the page. Precedent for reaching across: `FolioBlobService`
// imports `folioAssetPath` from the same tree. It is a pure function with no
// imports of its own.
import { displayName } from "../../web/app/services/displayName.ts";
import {
  questAcceptParamsSchema,
  questAcceptResultSchema,
  questCommentAddParamsSchema,
  questCommentAddResultSchema,
  questCompleteParamsSchema,
  questCompleteResultSchema,
  questCreateParamsSchema,
  questCreateResultSchema,
  questDeleteParamsSchema,
  questDeleteResultSchema,
  questGetParamsSchema,
  questGetResultSchema,
  questListParamsSchema,
  questListResultSchema,
  questShelveParamsSchema,
  questShelveResultSchema,
  questTagsParamsSchema,
  questTagsResultSchema,
  questUnshelveParamsSchema,
  questUnshelveResultSchema,
  questUpdateParamsSchema,
  questUpdateResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for quest operations.
 */
export class QuestTools {
  protected readonly questController = $inject(QuestController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly feedbackController = $inject(FeedbackController);
  protected readonly epicController = $inject(EpicController);
  protected readonly commentController = $inject(QuestCommentController);
  protected readonly questMapper = $inject(QuestResourceMapper);

  /**
   * How many comments `quest_get` inlines. A quest that ever carries more
   * than this is the day this grows a cursor; until then a second list tool
   * would be a surface with no readers.
   */
  protected readonly discussionCap = 50;

  /**
   * A quest's discussion, with authors resolved to names.
   *
   * `getProjectUsers` is one call for the whole thread, not one per comment,
   * and it is skipped entirely when the thread is empty — the common case
   * for a freshly filed quest.
   */
  protected async loadDiscussion(
    questId: number,
    projectId: number,
  ): Promise<{
    discussion: Array<{
      id: number;
      author?: string;
      body: string;
      createdAt: string;
      editedAt?: string;
    }>;
    discussionTruncated: boolean;
  }> {
    const rows = await this.commentController.listQuestComments({
      params: { id: questId },
      query: { limit: this.discussionCap + 1 },
    });
    if (rows.length === 0) {
      return { discussion: [], discussionTruncated: false };
    }

    const discussionTruncated = rows.length > this.discussionCap;
    const kept = discussionTruncated ? rows.slice(-this.discussionCap) : rows;

    const users = await this.projectController.getProjectUsers({
      params: { id: projectId },
    });

    return {
      discussion: kept.map((comment) => ({
        id: comment.id,
        author: comment.authorId
          ? displayName(
              users.find((u) => u.id === comment.authorId),
              comment.authorId,
            )
          : undefined,
        body: comment.body,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
      })),
      discussionTruncated,
    };
  }

  /**
   * Resolve a per-project feedback `shortId` to its global feedback id, so a
   * quest can be linked to it. Throws if no feedback in the project carries
   * that shortId.
   */
  protected async resolveFeedbackId(
    projectId: number,
    shortId: number,
  ): Promise<number> {
    const result = await this.feedbackController.listFeedback({
      params: { projectId },
      query: { status: "all" },
    });
    const found = result.items.find((p) => p.shortId === shortId);
    if (!found) {
      throw new NotFoundError(
        `Feedback with shortId ${shortId} not found in this project`,
      );
    }
    return found.id;
  }

  /**
   * Resolve project ID from params (by ID or name).
   */
  protected async resolveProjectId(
    project?: number,
    projectName?: string,
  ): Promise<number> {
    const projects = await this.projectController.getMyProjects();

    if (project) {
      const found = projects.find((p) => p.id === project);
      if (!found) {
        throw new NotFoundError(`Project with ID ${project} not found`);
      }
      return found.id;
    }

    if (projectName) {
      const found = projects.find(
        (p) => p.title.toLowerCase() === projectName.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Project "${projectName}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Project is required. Specify project ID or project_name.",
    );
  }

  /**
   * Build an `epicId -> { number, title, status }` lookup for every epic
   * in a project, so `quest_list` can stamp up to 100 returned quests with
   * their epic in one extra call instead of one per quest. `quest_list` is
   * deliberately not gated over MCP (design §5.3), so a result can mix a
   * planned epic's quests with released ones — the epic's status is what
   * lets a caller tell them apart.
   */
  protected async buildEpicRefMap(
    projectId: number,
  ): Promise<
    Map<
      number,
      { number: number; title: string; status: EpicResource["status"] }
    >
  > {
    const projectEpics = await this.epicController.getEpics({
      params: { projectId },
    });
    return new Map(
      projectEpics.map((epic) => [
        epic.id,
        { number: epic.number, title: epic.title, status: epic.status },
      ]),
    );
  }

  /**
   * Get quest status from quest data. Delegates so the MCP surface cannot
   * drift from the status the REST resource and the controller's transition
   * guards report — this used to be a third, independently-ordered copy.
   */
  protected getQuestStatus(quest: {
    acceptedAt?: string;
    completedAt?: string;
    shelvedAt?: string;
  }): QuestStatus {
    return this.questMapper.questStatus(quest);
  }

  /**
   * Accept either a global `id` or a per-project `shortId` reference
   * (with `project` / `project_name`) and return the global quest id.
   */
  protected async resolveQuestId(params: {
    id?: number;
    shortId?: number;
    project?: number;
    project_name?: string;
  }): Promise<number> {
    if (params.id != null) return params.id;
    if (params.shortId != null) {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const quest = await this.questController.getQuestByShortId({
        params: { projectId, shortId: params.shortId },
      });
      return quest.id;
    }
    throw new BadRequestError(
      "Quest reference required: pass `id` (global) or `shortId` (per-project — also requires `project` or `project_name`).",
    );
  }

  /**
   * Leave a comment on a quest.
   */
  quest_comment_add = $tool({
    description:
      "Leave a comment on a quest, as yourself. Comments interleave with the quest's own history into its Discussion, and are what an agent uses to report what it decided, what it could not do, or what the next session should know. Read them back with `quest_get`.",
    title: "Comment on a quest",
    annotations: { readOnlyHint: false, idempotentHint: false },
    schema: {
      params: questCommentAddParamsSchema,
      result: questCommentAddResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const comment = await this.commentController.createQuestComment({
        params: { id },
        body: { body: params.body },
      });

      // The author is the session user, so it is whoever the caller is —
      // resolving the name here would cost a round-trip to tell them
      // something they already know.
      return {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
      };
    },
  });

  /**
   * List quests for a project.
   */
  quest_list = $tool({
    description:
      'List quests for the project. Can filter by status (new, accepted, completed, shelved), search by title, or filter by a single tag (use `quest_tags` to discover existing tag values). Shelved quests — deliberately set aside as out of scope — are hidden unless you pass `status: "shelved"`.',
    title: "List quests",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: questListParamsSchema,
      result: questListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const size = params.limit ?? 20;
      const page = params.offset ? Math.floor(params.offset / size) : 0;

      const result = await this.questController.getQuests({
        params: { projectId },
        query: {
          status: params.status,
          search: params.search,
          tag: params.tag,
          epic: params.epic,
          size,
          page,
          // MCP is deliberately NOT gated (spec §5.3): an agent that files a
          // quest into a planned epic must see it in its own next call, or
          // this tool looks as though it silently failed. The UI's listing
          // surfaces never set this — only this tool does.
          includePlanned: true,
        },
      });

      // One extra call for the whole page rather than one per quest —
      // `quest_list` can return up to 100 quests, and every one of them
      // needs its epic stamped (design §5.3).
      const epicRefs = await this.buildEpicRefMap(projectId);

      return {
        quests: result.content.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          description: quest.description,
          area: quest.area,
          priority: quest.priority,
          status: this.getQuestStatus(quest),
          objectives: quest.objectives,
          tags: quest.tags,
          createdAt: quest.createdAt,
          acceptedAt: quest.acceptedAt,
          completedAt: quest.completedAt,
          shelvedAt: quest.shelvedAt,
          epic: quest.epicId != null ? epicRefs.get(quest.epicId) : undefined,
        })),
        total: result.page.totalElements ?? 0,
        hasMore: !result.page.isLast,
      };
    },
  });

  /**
   * Create a new quest.
   */
  quest_create = $tool({
    description:
      "Create a new quest in the project. Pass `accept: true` to also accept it (assign it to yourself) in the same call — skips a separate quest_accept round-trip.",
    title: "Create quest",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: questCreateParamsSchema,
      result: questCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      // Resolve `dependsOn_shortId` → global quest id (same project).
      let dependsOn: number | undefined;
      if (params.dependsOn_shortId != null) {
        const pred = await this.questController.getQuestByShortId({
          params: { projectId, shortId: params.dependsOn_shortId },
        });
        dependsOn = pred.id;
      }
      // Resolve `feedback_shortId` → global feedback id (same project).
      let feedbackId: number | undefined;
      if (params.feedback_shortId != null) {
        feedbackId = await this.resolveFeedbackId(
          projectId,
          params.feedback_shortId,
        );
      }
      // Resolve `epic_number` → global epic id (same project). Read-only
      // lookup, so any project member can resolve it; the attach below is
      // what actually requires ownership.
      let epicId: number | undefined;
      if (params.epic_number != null) {
        const epic = await this.epicController.getEpicByNumber({
          params: { projectId, number: params.epic_number },
        });
        epicId = epic.id;
      }
      const quest = await this.questController.createQuest({
        body: {
          projectId,
          title: params.title,
          description: params.description,
          area: params.area,
          priority: params.priority,
          objectives: params.objectives,
          tags: params.tags,
          dependsOn,
          feedbackId,
        },
      });

      // File the quest into its epic. `QuestController.createQuest` has no
      // `epicId` field of its own — `EpicController` owns that mutation
      // (owner-gated, same as every other epic mutation), so this is a
      // second call rather than part of the create body.
      //
      // `attachQuest` is owner-gated, but `createQuest` above only needed
      // `quest:create` — a member who created the quest can also delete it
      // (`QuestController.deleteQuest`'s `createdBy === user.id` check), so
      // a non-owner member with `epic_number` set can reach this attach and
      // have it refused. Clean up rather than leave an orphaned, unlinked
      // quest behind: an agent that sees the error and retries would
      // otherwise create a duplicate every time. The original error (not
      // any delete failure) is what the caller sees.
      if (epicId != null) {
        try {
          await this.epicController.attachQuest({
            params: { id: epicId },
            body: { questId: quest.id },
          });
        } catch (error) {
          await this.questController.deleteQuest({ params: { id: quest.id } });
          throw error;
        }
      }

      // `accept: true` mirrors the UI's "Create and accept" split button:
      // chain an accept onto the create so an agent about to work the quest
      // skips a second quest_accept round-trip. Best-effort and non-atomic
      // (same as the UI, which fires two sequential calls): if the accept is
      // refused — the only realistic case on a brand-new quest is a
      // questline gate, i.e. `dependsOn` points at an incomplete predecessor
      // — the quest stays created and we surface the reason in `acceptNote`
      // instead of failing the whole tool call.
      let acceptedAt: string | undefined;
      let acceptNote: string | undefined;
      if (params.accept) {
        try {
          const accepted = await this.questController.acceptQuest({
            params: { id: quest.id },
          });
          acceptedAt = accepted.acceptedAt;
        } catch (error) {
          acceptNote =
            error instanceof Error
              ? error.message
              : "Quest created, but it could not be accepted.";
        }
      }

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        createdAt: quest.createdAt,
        acceptedAt,
        acceptNote,
      };
    },
  });

  /**
   * Accept a quest (assign it to yourself).
   */
  quest_accept = $tool({
    description:
      "Accept a quest to start working on it. This assigns the quest to you.",
    title: "Accept quest",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: questAcceptParamsSchema,
      result: questAcceptResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.acceptQuest({
        params: { id },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        acceptedAt: quest.acceptedAt!,
      };
    },
  });

  /**
   * Shelve a quest — set it aside as out of scope without deleting it.
   */
  quest_shelve = $tool({
    description:
      "Shelve a quest: set it aside as out of scope for now without deleting it. Shelved quests disappear from the default `quest_list` and from project progress/stats, but keep their description, objectives and history — call `quest_unshelve` to bring one back. Only quests still in the 'new' status can be shelved; abandon an accepted quest first. Use this instead of `quest_delete` when the idea is worth keeping but nobody intends to work it now.",
    title: "Shelve quest",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    schema: {
      params: questShelveParamsSchema,
      result: questShelveResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.shelveQuest({
        params: { id },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        shelvedAt: quest.shelvedAt!,
      };
    },
  });

  /**
   * Unshelve a quest — bring it back into the backlog.
   */
  quest_unshelve = $tool({
    description:
      "Bring a shelved quest back into the backlog as 'new'. Use `quest_list` with `status: \"shelved\"` to see what is currently on the shelf.",
    title: "Unshelve quest",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    schema: {
      params: questUnshelveParamsSchema,
      result: questUnshelveResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.unshelveQuest({
        params: { id },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        status: this.getQuestStatus(quest),
      };
    },
  });

  /**
   * Complete a quest.
   */
  quest_complete = $tool({
    description:
      "Mark a quest as complete. All objectives must be completed first. Pass `message` with a short summary of what was actually done — the summary is persisted on the quest, shown in the UI, and returned by `quest_get` / `project_context` so future agents working on this project can read it. Leaving it blank is allowed but wastes a free way to hand context to the next session.",
    title: "Complete quest",
    annotations: {
      // destructive: state-altering; cannot be undone
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: questCompleteParamsSchema,
      result: questCompleteResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const result = await this.questController.completeQuest({
        params: { id },
        body: { message: params.message },
      });

      return {
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        completedAt: result.completedAt!,
      };
    },
  });

  /**
   * Get a single quest by ID.
   */
  quest_get = $tool({
    description:
      "Fetch a single quest by ID, including its current objectives, description, status, timestamps AND its discussion — the comments people have left on it, oldest first. Use this before quest_update to see current state, and to read what was said about the quest before working on it.",
    title: "Get quest",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: questGetParamsSchema,
      result: questGetResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.getQuestById({
        params: { id },
      });

      let dependsOn_shortId: number | undefined;
      if (quest.dependsOn != null) {
        const pred = await this.questController.getQuestById({
          params: { id: quest.dependsOn },
        });
        dependsOn_shortId = pred.shortId;
      }

      // `quest_get` is direct addressing, so it never gates on the epic's
      // status (design §5.3) — this is purely enrichment. Skip the extra
      // call entirely when the quest has no epic, the common case.
      let epic:
        | { number: number; title: string; status: EpicResource["status"] }
        | undefined;
      if (quest.epicId != null) {
        const epicRefs = await this.buildEpicRefMap(quest.projectId);
        epic = epicRefs.get(quest.epicId);
      }

      // Read as well as write: an agent that can comment but cannot see the
      // owner's reply has half the loop, and "do X differently" left on a
      // quest is exactly what the next session must find.
      const { discussion, discussionTruncated } = await this.loadDiscussion(
        quest.id,
        quest.projectId,
      );

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        description: quest.description,
        area: quest.area,
        priority: quest.priority,
        status: this.getQuestStatus(quest),
        objectives: quest.objectives,
        projectId: quest.projectId,
        milestoneId: quest.milestoneId,
        discussion,
        discussionTruncated,
        createdAt: quest.createdAt,
        updatedAt: quest.updatedAt,
        acceptedAt: quest.acceptedAt,
        completedAt: quest.completedAt,
        shelvedAt: quest.shelvedAt,
        completionMessage: quest.completionMessage,
        completionMessageUpdatedAt: quest.completionMessageUpdatedAt,
        tags: quest.tags,
        dependsOn_shortId,
        epic,
      };
    },
  });

  /**
   * List the distinct set of tags used by any quest in a project — fuel
   * for autocomplete and dedup. Mirrors `folio_tags`.
   */
  quest_tags = $tool({
    description:
      "List every tag used by any quest in the project. Call before `quest_create` / `quest_update` so you reuse existing tags (`bug`, `feat`, `chore`, …) instead of inventing slight variants like `Bug` / `bugs`.",
    title: "List quest tags",
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    schema: {
      params: questTagsParamsSchema,
      result: questTagsResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const tags = await this.questController.listQuestTags({
        query: { projectId },
      });
      return { tags };
    },
  });

  /**
   * Update a quest.
   */
  quest_update = $tool({
    description:
      "Update a quest's properties. Non-completed quests accept any field; completed quests only accept `completionMessage` (project memory stays curatable, but the quest body is frozen as an audit record). Omitted fields stay unchanged. Note: passing `objectives` REPLACES the entire objectives array — fetch the current quest first (quest_get or quest_list) and pass back the full list with your edits.",
    title: "Update quest",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: questUpdateParamsSchema,
      result: questUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      // `dependsOn_shortId` / `feedback_shortId` / `epic_number` all resolve
      // against the quest's OWN project; fetch it once if any is supplied.
      // `epic_number === 0` needs it too (unlike the other two) — clearing
      // the epic link means detaching from the quest's CURRENT epic, and
      // `current.epicId` is the only place that id comes from.
      const needsProject =
        (params.dependsOn_shortId != null && params.dependsOn_shortId !== 0) ||
        (params.feedback_shortId != null && params.feedback_shortId !== 0) ||
        params.epic_number != null;
      const current = needsProject
        ? await this.questController.getQuestById({ params: { id } })
        : undefined;

      // Translate `dependsOn_shortId` for update: 0 = clear, integer =
      // resolve to global id within the same project as the quest.
      let dependsOn: number | null | undefined;
      if (params.dependsOn_shortId === 0) {
        dependsOn = null;
      } else if (params.dependsOn_shortId != null && current) {
        const pred = await this.questController.getQuestByShortId({
          params: {
            projectId: current.projectId,
            shortId: params.dependsOn_shortId,
          },
        });
        dependsOn = pred.id;
      }

      // Translate `feedback_shortId`: 0 = unlink, integer = resolve to the
      // underlying global id within the quest's project.
      let feedbackId: number | null | undefined;
      if (params.feedback_shortId === 0) {
        feedbackId = null;
      } else if (params.feedback_shortId != null && current) {
        feedbackId = await this.resolveFeedbackId(
          current.projectId,
          params.feedback_shortId,
        );
      }

      // Translate `epic_number`: 0 = detach from the quest's current epic
      // (a no-op if it has none), integer = resolve to a global epic id
      // within the quest's project and attach. Unlike `dependsOn` /
      // `feedbackId` above, this mutation goes through `EpicController`
      // (owner-gated, same as every other epic mutation) rather than this
      // action's own body — it has no `epicId` field.
      let epicAttachId: number | undefined;
      let epicDetachId: number | undefined;
      if (params.epic_number === 0) {
        if (current?.epicId != null) {
          epicDetachId = current.epicId;
        }
      } else if (params.epic_number != null && current) {
        const epic = await this.epicController.getEpicByNumber({
          params: { projectId: current.projectId, number: params.epic_number },
        });
        epicAttachId = epic.id;
      }

      // Apply the epic mutation BEFORE the general field update, not after.
      // `attachQuest`/`detachQuest` are owner-gated while `updateQuestById`
      // only needs `quest:update` (a non-owner member who can edit the
      // quest can still be refused here) — doing this first means a
      // refusal throws before any other field is written, so there is no
      // window where some fields land and the epic link silently does not.
      if (epicAttachId != null) {
        await this.epicController.attachQuest({
          params: { id: epicAttachId },
          body: { questId: id },
        });
      } else if (epicDetachId != null) {
        await this.epicController.detachQuest({
          params: { id: epicDetachId, questId: id },
        });
      }

      const quest = await this.questController.updateQuestById({
        params: { id },
        body: {
          title: params.title,
          description: params.description,
          area: params.area,
          priority: params.priority,
          objectives: params.objectives,
          completionMessage: params.completionMessage,
          tags: params.tags,
          dependsOn,
          feedbackId,
        },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        updatedAt: quest.updatedAt,
      };
    },
  });

  /**
   * Delete a quest.
   */
  quest_delete = $tool({
    description:
      "Permanently delete a quest. Use this to clean up mistakenly-created quests. Only the quest creator or project owner can delete. Cannot be undone.",
    title: "Delete quest",
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: questDeleteParamsSchema,
      result: questDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      await this.questController.deleteQuest({
        params: { id },
      });
      return { ok: true };
    },
  });
}
