import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { EpicController } from "../../api/controllers/EpicController.ts";
import { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { QuestCommentController } from "../../api/controllers/QuestCommentController.ts";
import { QuestController } from "../../api/controllers/QuestController.ts";
import { ReleaseController } from "../../api/controllers/ReleaseController.ts";
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
  questAttachmentAddParamsSchema,
  questAttachmentAddResultSchema,
  questAttachmentGetParamsSchema,
  questCommentAddParamsSchema,
  questCommentAddResultSchema,
  questCommitAddParamsSchema,
  questCommitAddResultSchema,
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
  questObjectiveSetParamsSchema,
  questObjectiveSetResultSchema,
  questShelveParamsSchema,
  questShelveResultSchema,
  questTagsParamsSchema,
  questTagsResultSchema,
  questUnassignParamsSchema,
  questUnassignResultSchema,
  questUnshelveParamsSchema,
  questUnshelveResultSchema,
  questUpdateParamsSchema,
  questUpdateResultSchema,
} from "../schemas/index.ts";
import { AttachmentContentService } from "../services/AttachmentContentService.ts";
import { DiagramCheckService } from "../services/DiagramCheckService.ts";
import { EpicRefService } from "../services/EpicRefService.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP tools for quest operations.
 */
export class QuestTools {
  protected readonly questController = $inject(QuestController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly feedbackController = $inject(FeedbackController);
  protected readonly epicController = $inject(EpicController);
  protected readonly releaseController = $inject(ReleaseController);
  protected readonly epicRefs = $inject(EpicRefService);
  protected readonly commentController = $inject(QuestCommentController);
  protected readonly questMapper = $inject(QuestResourceMapper);
  protected readonly attachmentContent = $inject(AttachmentContentService);
  protected readonly diagrams = $inject(DiagramCheckService);
  protected readonly projectTools = $inject(ProjectTools);

  /**
   * What `quest_attachment_add` accepts.
   *
   * Not the storage's own list, which is far wider: this one is exactly the
   * set `quest_attachment_get` can render back inline, so an agent can
   * always read what an agent wrote. Everything here is also inert when
   * served from `/api/files/:id`, which is the property the storage's list
   * is really protecting.
   */
  protected readonly attachableMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/json",
  ];

  /**
   * 2 MB decoded. Screenshots and logs, not binaries.
   */
  protected readonly maxAttachmentBytes = 2 * 1024 * 1024;

  /**
   * Decode a base64 payload, refusing anything that is not actually base64.
   *
   * `Buffer.from(x, "base64")` never throws: it silently drops characters
   * it does not recognise, so a truncated or corrupted payload would be
   * stored as a shorter, broken file. Validating the alphabet first is what
   * turns that into an error the caller can act on.
   */
  protected decodeBase64(data: string): Buffer {
    const compact = data.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
      throw new BadRequestError(
        "`data` is not valid base64. Send the raw base64 of the file's bytes, with no data-URL prefix.",
      );
    }
    return Buffer.from(compact, "base64");
  }

  /**
   * How many comments `quest_get` inlines. A quest that ever carries more
   * than this is the day this grows a cursor; until then a second list tool
   * would be a surface with no readers.
   */
  protected readonly discussionCap = 50;

  /**
   * Who actually wrote a comment.
   *
   * Absent provenance means a human typed it in the UI: `source` is written
   * only by `quest_comment_add`, and the web client never sends it.
   */
  protected authorKindOf(comment: {
    source?: { kind?: string };
  }): "human" | "agent" {
    return comment.source?.kind === "mcp" ? "agent" : "human";
  }

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
      authorKind: "human" | "agent";
      client?: string;
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
        // The account name is the same either way over MCP, which is
        // exactly why this field has to exist.
        authorKind: this.authorKindOf(comment),
        client: comment.source?.client,
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
   * Resolve a release tag to its global id, within one project.
   *
   * By tag rather than by number, everywhere in this surface: an agent writes
   * `0.28.0`, not `3`. Case-sensitive, because a tag's case is preserved so
   * it can match `artifacts.tag` byte for byte - see `releaseTagSchema`.
   */
  protected async resolveReleaseId(
    projectId: number,
    tag: string,
  ): Promise<number> {
    const found = (
      await this.releaseController.getReleases({ params: { projectId } })
    ).find((release) => release.tag === tag);
    if (!found) {
      throw new NotFoundError(`Release '${tag}' not found in this project`);
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
    // One implementation, in `ProjectTools`. See the note there.
    return await this.projectTools.resolveProjectId(project, projectName);
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
      "Leave a comment on a quest, as yourself. Comments interleave with the quest's own history into its Discussion, and are what an agent uses to report what it decided, what it could not do, or what the next session should know. Read them back with `quest_get`. " +
      "Anything posted through this tool is recorded as agent-authored and shown that way in Lore, so do not sign your messages or announce that you are an AI: the thread already says so.",
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
        // Stamped unconditionally: this tool is only ever reached over MCP,
        // so every comment it writes was written by a machine. Without it
        // the row is indistinguishable from one the owner typed, because
        // over MCP the session user IS the owner's account.
        // `client` is self-reported, exactly as `clientInfo.name` would be,
        // so taking it as a param costs nothing in trust. Reading it off
        // `initialize` instead needs framework plumbing: the Streamable HTTP
        // transport keeps no per-session state, and the provider is a
        // process-global singleton, which is the same shape that already had
        // to be backed out for protocol-version negotiation.
        body: { body: params.body, source: { kind: "mcp", client: params.as } },
      });

      // The author is the session user, so it is whoever the caller is —
      // resolving the name here would cost a round-trip to tell them
      // something they already know.
      return {
        id: comment.id,
        authorKind: this.authorKindOf(comment),
        client: comment.source?.client,
        body: comment.body,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        ...this.diagrams.warn(params.body),
      };
    },
  });

  /**
   * List quests for a project.
   */
  quest_list = $tool({
    description:
      'List quests for the project. Can filter by status (new, accepted, completed, shelved), search by title, or filter by a single tag (use `quest_tags` to discover existing tag values). Shelved quests — deliberately set aside as out of scope — are hidden unless you pass `status: "shelved"`. ' +
      "Rows carry `updatedAt`, `commentCount` and `lastCommentAt`, and the default order is newest-updated first: keep the timestamp of your last call, and any row whose `lastCommentAt` is later than it means someone spoke since. Read that quest with `quest_get` before writing back to it, or you will answer a conversation you have not seen. " +
      'Descriptions and objectives are NOT inlined by default; pass `detail: "full"` only when you mean to read them all, and `quest_get` when you want one quest in depth.',
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

      const result = await this.questController.getQuests({
        params: { projectId },
        query: {
          status: params.status,
          search: params.search,
          tag: params.tag,
          epic: params.epic,
          size,
          // Honoured as given. It used to be divided into a page number, so
          // `offset: 25, limit: 20` returned rows 20-39 while the tool doc
          // promised 25-44.
          offset: params.offset,
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
      const epicRefs = await this.epicRefs.mapFor(projectId);

      // Same shape, second signal: one query for the page's whole
      // discussion metadata. An agent listing a project has to be able to
      // tell that someone spoke since it last looked, and the alternative
      // is a `quest_get` per row.
      const commentStats = await this.commentController.commentStatsFor(
        result.content.map((quest) => quest.id),
      );

      // Bodies are opt-in. 24 quests came back as 61.9 KB when every
      // description was inlined, which the client spilled to a file; the
      // question a list answers is which quests exist and which ones moved.
      const full = params.detail === "full";

      return {
        quests: result.content.map((quest) => ({
          id: quest.id,
          shortId: quest.shortId,
          title: quest.title,
          description: full ? quest.description : undefined,
          area: quest.area,
          priority: quest.priority,
          size: quest.size,
          status: this.getQuestStatus(quest),
          objectives: full ? quest.objectives : undefined,
          objectivesProgress: quest.metadata.objectivesProgress,
          tags: quest.tags,
          createdAt: quest.createdAt,
          updatedAt: quest.updatedAt,
          // The list itself, deliberately not: it would be a payload per
          // row for a signal a count already carries. `quest.attachments`
          // is on the row already, so this costs no lookup.
          attachmentCount: quest.attachments.length,
          commitCount: quest.commits?.length ?? 0,
          commentCount: commentStats.get(quest.id)?.count ?? 0,
          lastCommentAt: commentStats.get(quest.id)?.lastAt,
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
      // Resolve `release_tag` → global release id (same project). The
      // released-release refusal lives in `ReleaseAttachmentService`, which
      // `createQuest` calls: this only turns a name into an id.
      let releaseId: number | undefined;
      if (params.release_tag) {
        releaseId = await this.resolveReleaseId(projectId, params.release_tag);
      }
      const quest = await this.questController.createQuest({
        body: {
          projectId,
          releaseId,
          title: params.title,
          description: params.description,
          area: params.area,
          priority: params.priority,
          size: params.size,
          dueAt: params.dueAt,
          objectives: params.objectives,
          tags: params.tags,
          dependsOn,
          feedbackId,
        },
      });

      // File the quest into its epic. `QuestController.createQuest` has no
      // `epicId` field of its own — `EpicController` owns that mutation, so
      // this is a second call rather than part of the create body.
      //
      // Two calls means the second can fail on its own. Clean up rather
      // than leave an orphaned, unlinked quest behind: an agent that sees
      // the error and retries would otherwise create a duplicate every
      // time. The original error (not any delete failure) is what the
      // caller sees. The refusal this was written for was the epic gate
      // (`attachQuest` was owner-only while `createQuest` needed
      // `quest:create`); epic mutations are member-gated now, so the
      // compensation is no longer reachable that way — it stays because
      // the second call can still fail, and a half-written create is the
      // worst thing to hand an agent.
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
        ...this.diagrams.warn(params.description),
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
      "Shelve a quest: set it aside as out of scope for now without deleting it. Shelved quests disappear from the default `quest_list` and from project progress/stats, but keep their description, objectives and history — call `quest_unshelve` to bring one back. Only quests still in the 'new' status can be shelved; call `quest_unassign` first on an accepted one. Use this instead of `quest_delete` when the idea is worth keeping but nobody intends to work it now.",
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
   * Send an accepted quest back to the backlog.
   */
  quest_unassign = $tool({
    description:
      "Send an accepted quest back to the backlog as 'new': clears the assignee and any reminders, and keeps everything written on it (description, objectives, comments, history). Use it when you took a quest you are not going to work, or when handing one back. " +
      "It is also the step before `quest_shelve` on an accepted quest, which only accepts quests in 'new'. Nothing is deleted; `quest_delete` is the destructive one.",
    title: "Unassign quest",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    schema: {
      params: questUnassignParamsSchema,
      result: questUnassignResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      // The controller method is still named `abandonQuest`. The UI renamed
      // the action to Unassign on 2026-08-20 because it never deleted
      // anything, and the tool follows the vocabulary rather than the
      // method name.
      const quest = await this.questController.abandonQuest({
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
      "Mark a quest as complete. Every objective must be either ticked or waived. Pass `message` with a short summary of what was actually done — the summary is persisted on the quest, shown in the UI, and returned by `quest_get` / `project_context` so future agents working on this project can read it. Leaving it blank is allowed but wastes a free way to hand context to the next session. " +
      "An objective you did not do is waived with a reason, never ticked: pass it in `waive` and it stays unticked with the reason shown on the quest. Ticking it instead would be indistinguishable from work that actually happened. " +
      "If you know what shipped, pass `commits` too; `quest_commit_add` records any sha that turns up after the merge.",
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
        body: {
          message: params.message,
          waive: params.waive,
          commits: params.commits,
        },
      });

      return {
        id: result.id,
        shortId: result.shortId,
        title: result.title,
        completedAt: result.completedAt!,
        ...this.diagrams.warn(params.message),
      };
    },
  });

  /**
   * Record what shipped for a quest.
   */
  quest_commit_add = $tool({
    description:
      'Record a commit against a quest, so "what shipped for #16" is a field on the quest instead of a grep of the git log for its number. Use it when a change lands, and pass the subject line too: a bare sha means nothing to a reader without the repository in front of them. ' +
      "Deduped on the sha, so recording the same commit twice is a no-op. Allowed on completed quests, which is the common case: the sha is usually known only after the merge. `quest_complete` takes the same list, for the commits you already have when you close the quest.",
    title: "Record a commit on a quest",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    schema: {
      params: questCommitAddParamsSchema,
      result: questCommitAddResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const quest = await this.questController.addQuestCommit({
        params: { id },
        body: {
          sha: params.sha,
          message: params.message,
          repo: params.repo,
        },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        commits: quest.commits ?? [],
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
      const epic = await this.epicRefs.refFor(quest.projectId, quest.epicId);

      // Read as well as write: an agent that can comment but cannot see the
      // owner's reply has half the loop, and "do X differently" left on a
      // quest is exactly what the next session must find.
      const { discussion, discussionTruncated } = await this.loadDiscussion(
        quest.id,
        quest.projectId,
      );

      // Skipped entirely when the quest carries no files, the common case,
      // and the same reasoning as the discussion load above.
      const attachments = quest.attachments.length
        ? (
            await this.questController.listQuestAttachments({
              params: { id: quest.id },
            })
          ).map((file) => ({
            id: file.fileId,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
          }))
        : [];

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        description: quest.description,
        area: quest.area,
        priority: quest.priority,
        size: quest.size,
        status: this.getQuestStatus(quest),
        objectives: quest.objectives,
        projectId: quest.projectId,
        releaseId: quest.releaseId,
        discussion,
        discussionTruncated,
        createdAt: quest.createdAt,
        updatedAt: quest.updatedAt,
        acceptedAt: quest.acceptedAt,
        completedAt: quest.completedAt,
        shelvedAt: quest.shelvedAt,
        dueAt: quest.dueAt,
        completionMessage: quest.completionMessage,
        completionMessageUpdatedAt: quest.completionMessageUpdatedAt,
        tags: quest.tags,
        dependsOn_shortId,
        commits: quest.commits ?? [],
        attachments,
        epic,
      };
    },
  });

  /**
   * Open one of a quest's attachments.
   */
  quest_attachment_get = $tool({
    description:
      "Fetch the actual content of one file attached to a quest. For images the bytes come back inline as an image block, so a screenshot the owner attached to explain a bug is something you can look at, not just a filename. Text-like files (txt/csv/json/markdown) are returned decoded; other binary types return a metadata note only. Pass `attachmentId` from a `quest_get` `attachments[].id`.",
    title: "Get quest attachment",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: questAttachmentGetParamsSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);
      const file = await this.questController.getQuestAttachment({
        params: { id, fileId: params.attachmentId },
      });

      return this.attachmentContent.render(file);
    },
  });

  /**
   * Attach a file to a quest.
   */
  quest_attachment_add = $tool({
    description:
      "Attach a file to a quest: a screenshot, a probe log, a CSV of measurements. Use it when you have evidence rather than a claim, since a file on the quest is something the owner can look at where numbers pasted into a comment are something they have to take your word for. " +
      "For screenshots and logs only, capped at 2 MB decoded, and restricted to the types `quest_attachment_get` can read back inline (png, jpeg, webp, gif, plain text, csv, markdown, json). Allowed on completed quests: evidence usually arrives at the end.",
    title: "Attach a file to a quest",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: questAttachmentAddParamsSchema,
      result: questAttachmentAddResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);

      if (!this.attachableMimeTypes.includes(params.mimeType)) {
        throw new BadRequestError(
          `mimeType "${params.mimeType}" is not accepted here. Use one of: ${this.attachableMimeTypes.join(", ")}.`,
        );
      }

      const bytes = this.decodeBase64(params.data);
      if (bytes.byteLength > this.maxAttachmentBytes) {
        throw new BadRequestError(
          `Attachment is ${bytes.byteLength} bytes decoded, over the ${this.maxAttachmentBytes} byte limit. This is for screenshots and logs; put anything larger somewhere it belongs and link to it.`,
        );
      }

      const uploaded = await this.questController.uploadAttachment({
        body: {
          file: new File([new Uint8Array(bytes)], params.name, {
            type: params.mimeType,
          }),
        },
      });
      // Two calls, same as the UI: the bytes go to storage, then the file
      // id is recorded on the quest. `addAttachment` dedupes on the id, so
      // a retry cannot double up.
      await this.questController.addAttachment({
        params: { id },
        body: { fileId: uploaded.fileId },
      });

      const files = await this.questController.listQuestAttachments({
        params: { id },
      });
      const file = files.find((it) => it.fileId === uploaded.fileId);

      return {
        id: uploaded.fileId,
        name: file?.name ?? params.name,
        mimeType: file?.mimeType ?? params.mimeType,
        size: file?.size ?? bytes.byteLength,
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
   * Tick or untick one objective, without resending the array.
   */
  quest_objective_set = $tool({
    description:
      "Set one objective's completed state on an accepted quest. Use this rather than `quest_update` whenever you are only ticking a box: a `quest_update` replace has to carry every objective, and one typo there renames an objective while one omission deletes it. " +
      "Sets rather than toggles, so it is safe to repeat. Only works while the quest is accepted, because ticking work on a quest nobody has started is meaningless: `quest_accept` first.",
    title: "Set a quest objective",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    schema: {
      params: questObjectiveSetParamsSchema,
      result: questObjectiveSetResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveQuestId(params);

      // `completeObjective` FLIPS. Read first and call it only when the
      // state actually differs, which is what makes this tool idempotent:
      // an agent retrying after a dropped response must not untick the box
      // it just ticked.
      const quest = await this.questController.getQuestById({ params: { id } });
      const target = quest.objectives.find((o) => o.id === params.objectiveId);
      if (!target) {
        throw new NotFoundError(
          `Objective ${params.objectiveId} not found on quest #${quest.shortId}.`,
        );
      }

      const after =
        target.completed === params.completed
          ? quest
          : await this.questController.completeObjective({
              params: { id },
              body: { objectiveId: params.objectiveId },
            });

      return {
        id: after.id,
        shortId: after.shortId,
        objectives: after.objectives,
      };
    },
  });

  /**
   * Update a quest.
   */
  quest_update = $tool({
    description:
      "Update a quest's properties. Non-completed quests accept any field; completed quests only accept `completionMessage` (project memory stays curatable, but the quest body is frozen as an audit record). Omitted fields stay unchanged. " +
      "Passing `objectives` REPLACES the entire array, so fetch the quest first and pass back the full list, each surviving item carrying the `id` it already had. That path is for rewording, reordering, adding or removing objectives; to tick or untick one, call `quest_objective_set` instead of resending everything. " +
      "Nothing here stops you overwriting an edit someone made while you were working: pass `expectedUpdatedAt` from your last `quest_get` and a 409 will tell you to re-read instead.",
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
        params.epic_number != null ||
        // A non-empty tag needs the project to resolve against. An empty one
        // clears, which `updateQuestById` does from `null` alone.
        !!params.release_tag;
      // An epic move is a write of its own (`attachQuest` sets `epicId`,
      // which stamps `updatedAt`), and it happens BEFORE the field update
      // below. So when both are requested the controller's own check would
      // see a row this very call had just moved and refuse every time.
      // Check here instead, before anything is written, and let the
      // controller check when there is no epic move to get in the way.
      const epicMove = params.epic_number != null;
      const needsCurrent = needsProject || params.expectedUpdatedAt != null;
      const current = needsCurrent
        ? await this.questController.getQuestById({ params: { id } })
        : undefined;

      if (
        epicMove &&
        params.expectedUpdatedAt != null &&
        current &&
        current.updatedAt !== params.expectedUpdatedAt
      ) {
        throw new ConflictError(
          `Quest #${current.shortId} changed since you read it: its updatedAt is ${current.updatedAt}, you passed ${params.expectedUpdatedAt}. Re-read the quest before writing.`,
        );
      }

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
      // rather than this action's own body — it has no `epicId` field.
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

      // Translate `release_tag`: "" = detach, a tag = resolve to a global
      // release id in the quest's project. Unlike the epic move above this
      // is a plain field on `updateQuestById`, so it needs no second call
      // and no compensation - and the refusal on a published release (in
      // either direction) is applied there, by the shared service.
      let releaseId: number | null | undefined;
      if (params.release_tag === "") {
        releaseId = null;
      } else if (params.release_tag != null && current) {
        releaseId = await this.resolveReleaseId(
          current.projectId,
          params.release_tag,
        );
      }

      // Apply the epic mutation BEFORE the general field update, not after.
      // It is a separate call to a separate controller and can fail on its
      // own; doing it first means such a failure throws before any other
      // field is written, so there is no window where some fields land and
      // the epic link silently does not. (The refusal originally in view
      // was the owner gate on `attachQuest`/`detachQuest`, which is now
      // membership like `updateQuestById`'s — the ordering argument does
      // not depend on which failure it is.)
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
          size: params.size,
          dueAt: params.dueAt,
          objectives: params.objectives,
          completionMessage: params.completionMessage,
          tags: params.tags,
          dependsOn,
          feedbackId,
          releaseId,
          // Already checked above when an epic move preceded this write;
          // forwarding it there would compare against our own change.
          expectedUpdatedAt: epicMove ? undefined : params.expectedUpdatedAt,
        },
      });

      return {
        id: quest.id,
        shortId: quest.shortId,
        title: quest.title,
        updatedAt: quest.updatedAt,
        // Both markdown fields this tool can write. `completionMessage` is
        // the one an agent uses for a summary diagram, and it is the field
        // most likely to carry one.
        ...this.diagrams.warn(
          [params.description, params.completionMessage]
            .filter(Boolean)
            .join("\n\n"),
        ),
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
