import { $inject, z } from "alepha";
import { $storage, FileService } from "alepha/api/files";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, $transactional, db, pageQuerySchema } from "alepha/orm";
import {
  OwnedResourceProvider,
  $secure,
  type UserAccountToken,
} from "alepha/security";
import {
  $action,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { blights, QUEST_STATUS_PREFIX } from "../entities/blights.ts";
import { epics } from "../entities/epics.ts";
import { feedback } from "../entities/feedback.ts";
import type { Project } from "../entities/projects.ts";
import {
  normalizeQuestTags,
  type Quest,
  quests,
  REMINDER_INTERVAL_MS,
  REMINDER_INTERVAL_VALUES,
} from "../entities/quests.ts";
import { releases } from "../entities/releases.ts";
import { questCommitSchema } from "../schemas/questCommitSchema.ts";
import { questCreateSchema } from "../schemas/questCreateSchema.ts";
import {
  exceedsObjectiveCap,
  objectiveCapMessage,
} from "../schemas/questObjectivesLimit.ts";
import { QUEST_RELEASE_NONE } from "../schemas/questReleaseFilter.ts";
import {
  type QuestResource,
  type QuestStatus,
  questResourceSchema,
  questStatusSchema,
} from "../schemas/questResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AreaService } from "../services/AreaService.ts";
import { EpicVisibilityService } from "../services/EpicVisibilityService.ts";
import { EpicWorkflowService } from "../services/EpicWorkflowService.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { OpenQuestScope } from "../services/OpenQuestScope.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";
import { QuestService } from "../services/QuestService.ts";
import { ReleaseAttachmentService } from "../services/ReleaseAttachmentService.ts";

export class QuestController {
  /**
   * What `updateQuestById` still accepts once a quest is completed.
   *
   * ⚠️ **The rule is "not the body", not "almost nothing".** On a completed
   * quest the quest BODY - title, description, objectives - is frozen as an
   * audit record of what was closed, and `addAttachment` already carries that
   * sentence: the body stays frozen, "which is what the audit record is
   * actually protecting". Everything here is metadata about the record rather
   * than the record, so freezing it makes the history less accurate, not more:
   *
   * - `completionMessage`, because project memory is curatable.
   * - `releaseId`, because which release a finished quest ships in is planning
   *   metadata decided after completion at least as often as before it. A
   *   release HOLDS quests by assignment, so the assignment has to stay
   *   editable until the release is published - and the published-release
   *   refusal in `ReleaseAttachmentService` is what enforces that end.
   * - `feedbackId`, because which reported issue the work turned out to resolve
   *   is usually only established afterwards. There is no other writer:
   *   `createQuest`, this path and `feedback_accept` (which spawns a NEW quest)
   *   are the only three, and the feedback side has no "link an existing quest"
   *   endpoint at all. Added for #1752, found while trying to link 22 completed
   *   quests to the feedback they resolved.
   * - `area`, because it is already mutable on a completed quest through
   *   another door: `AreaService.rename` issues an `updateMany` with no
   *   `completedAt` filter, so the areas settings page rewrites completed
   *   quests wholesale. A field a bulk rename can change but a single-quest
   *   correction cannot is an inconsistency, not a guarantee.
   * - `tags`, on the same axis argument as `area` and with no side door at all:
   *   both are what reports and insights group by, retro-classification is
   *   normal, and a new tag in a project's vocabulary was unusable on exactly
   *   the history that motivated it.
   *
   * Deliberately NOT here: `priority` (what was prioritised at the time),
   * `size` / `estimateMinutes` / `dueAt` (the PLANNED values - actuals live in
   * the timer, and editing a plan after seeing the outcome erases the only
   * thing they are good for), `dependsOn` (it draws the recorded questline and
   * its live effect is dead post-completion either way) and `attachments`,
   * which has its own door: `addAttachment` allows `completed` on purpose,
   * because evidence arrives at the end.
   *
   * ⚠️ This gate runs BEFORE the field-specific guards below it, not instead of
   * them. Widening it widens what reaches `ensureArea`, the owner-only check on
   * `feedbackId` and the "feedback must exist in this project and be accepted"
   * check - all of which still run on the completed path.
   *
   * ⚠️ Three prose surfaces restate this list and go stale silently:
   * `QuestTools.quest_update`'s description, and the `feedback_shortId` and
   * `completionMessage` field descriptions in `questSchemas.ts`.
   */
  protected readonly editableAfterCompletion = new Set([
    "completionMessage",
    "releaseId",
    "feedbackId",
    "area",
    "tags",
  ]);

  log = $logger();
  quests = $repository(quests);
  feedback = $repository(feedback);
  blights = $repository(blights);
  /**
   * Read-only here, and only so a history line can name the epic or release a
   * quest moved to by its `number` / `tag` rather than by a row id nobody
   * recognises. Every MUTATION of either lives on its own controller, and
   * attaching to a release still goes through `ReleaseAttachmentService`
   * because a published release has to refuse it.
   */
  epics = $repository(epics);
  releases = $repository(releases);
  dt = $inject(DateTimeProvider);
  audits = $inject(LoreAudits);
  owned = $inject(OwnedResourceProvider);
  /**
   * Kept for {@link isMemberById} alone - the assignee check in
   * `assignQuest`, which asks about somebody other than the caller and so is
   * not a gate. Every gate on this class is `$ownsProject`.
   */
  security = $inject(ProjectSecurityService);
  epicVisibility = $inject(EpicVisibilityService);
  /**
   * The epic phase gate (epic #31): a quest can be worked only while its
   * epic is `active`, and deleted only while it is `planned`. Every refusal
   * and its wording is written on the service, once; the handlers below
   * only say which verb they are.
   */
  epicWorkflow = $inject(EpicWorkflowService);
  openQuests = $inject(OpenQuestScope);
  fileService = $inject(FileService);
  questMapper = $inject(QuestResourceMapper);
  questService = $inject(QuestService);
  areaService = $inject(AreaService);
  releaseAttachment = $inject(ReleaseAttachmentService);
  linkService = $inject(FolioLinkService);

  attachments = $storage({
    description: "Quest attachments",
    // Megabytes. This read `10 * 1024 * 1024`, i.e. a ten-million-megabyte
    // cap — no cap at all.
    maxSize: 10,
    // No `mimeTypes`, on purpose: a quest carries whatever the work needs,
    // an HTML mockup included. `$storage` reads an absent list as "any
    // type", the same as the folio attachment bucket. A member is someone the
    // project already trusts; feedback attachments come from anyone with an
    // account and keep their own narrow list.
    //
    // This was a closed list until 2026-09-04, excluding `text/html` and
    // `image/svg+xml` on the grounds that `/api/files/:id` serves a file
    // inline with the type it was stored under, which would make an
    // attachment stored XSS against the members who open it. That premise
    // was already false when it was written: `serializeResponse` sets
    // `Content-Disposition: attachment` on every `z.file()` response, so
    // the browser saves the file instead of rendering it, whatever the type
    // claims to be (`ServerRouterProvider`, pinned by
    // `ServerRouterProvider-serializeResponse.spec.ts`).
    //
    // So the served DISPOSITION is what guards this bucket, not the list.
    // What to check before changing any of it:
    //
    // - Serve an attachment without that header, or with `inline`, and every
    //   markup type here becomes executable in this origin. A download route
    //   that writes its own headers is the thing to watch for.
    // - The lightbox renders images through `<img>` and everything else as
    //   highlighted source (`attachmentPreview`). `<img>` does not run
    //   an SVG's scripts; an `<iframe>` or a `dangerouslySetInnerHTML` over
    //   attachment bytes would.
    // - `LoreFileAccessProvider` gates reads on project membership, so a
    //   file uploaded here is never reachable by a stranger holding the id.
  });

  /**
   * The four gates this controller needs.
   *
   * Declared above the actions on purpose: `use: [this.ownsQuest()]` is a
   * field initializer reading another field, so a gate declared below its
   * first use is `undefined` at construction time.
   *
   * ## ⚠️ On a `$transactional()` action the gate goes AFTER it
   *
   * The gate is not only an access check here - it is the READ HALF of every
   * check-then-write on this class. `completeQuest` is transactional "so two
   * concurrent completions cannot both pass the `completedAt IS NULL` read",
   * and `updateQuestById` for the same reason on `expectedUpdatedAt`. The
   * full reasoning is on `$ownsProject`; this is the file it was found in.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  protected ownsProjectFromBody = () =>
    $ownsProject({ param: "projectId", from: "body" });

  protected ownsProjectFromQuery = () =>
    $ownsProject({ param: "projectId", from: "query" });

  /**
   * Member gate on the project the quest named by `params.id` belongs to.
   *
   * The quest lands on `this.owned.get<Quest>()` and its project on
   * `this.owned.authority<Project>()`, which is what lets
   * {@link getQuestForTransition} keep only the status check.
   */
  protected ownsQuest = () =>
    $ownsProject({ repository: () => this.quests, param: "id" });

  /**
   * Enrich a quest entity with computed metadata.
   */
  mapQuestToResource(quest: Quest): QuestResource {
    return this.questMapper.mapQuestToResource(quest);
  }

  /**
   * One project-layer audit row for something that happened to a quest.
   *
   * Every quest mutation in this file goes through here rather than calling
   * `this.audits.quest` directly, because four of the five fields are the same
   * every time and the one that is not - the scope - is the one a hand-written
   * call site silently omits. A row without it is written, accepted, and never
   * appears on the Activity page.
   *
   * `resourceId` is the **shortId**, not the row id: it is what
   * `/:projectSlug/quests/:shortId` takes, so the feed can build a link out of
   * the row alone.
   *
   * Awaited inline, inside the caller's `$transactional()` where there is one,
   * which is the property worth keeping: a mutation that rolls back takes its
   * activity row with it, so the feed cannot show something that did not
   * happen. The cost is that a failing audit insert fails the mutation, which
   * is the same trade every existing call site in this app already makes.
   */
  protected async logQuest(
    action: string,
    quest: Pick<Quest, "shortId" | "title" | "projectId">,
    user: UserAccountToken | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.quest.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(quest.projectId),
      resourceType: "quest",
      resourceId: String(quest.shortId),
      description: quest.title,
      ...(metadata ? { metadata } : {}),
    });
  }

  /**
   * The lifecycle precondition for a state-changing endpoint, and nothing
   * else.
   *
   * These handlers used to fold the precondition into the `getOne`
   * where-clause (`acceptedAt: { isNotNull: true }`, …). A quest in the
   * wrong state then matched no row and came back as the ORM's
   * `DbEntityNotFoundError` — "Entity from 'quests' was not found" — which
   * says nothing about what to do next. MCP agents hit this constantly:
   * `quest_complete` on a quest still in "new" reported the quest as
   * missing when the real answer was "accept it first". Reading the row and
   * checking the status separately keeps 404 honest and turns a precondition
   * failure into a 400 naming both the current status and the required one.
   *
   * It used to load the quest and assert membership too, in that order, so
   * that a non-member learned nothing about the quest beyond its existence.
   * **That ordering is now structural**: `this.ownsQuest()` is middleware, so
   * it runs to completion before any handler that reaches this. It also
   * leaves the rows behind, which is why nothing is queried here.
   */
  protected getQuestForTransition(
    action: string,
    allowed: QuestStatus[],
  ): { quest: Quest; project: Project } {
    const quest = this.owned.get<Quest>();
    const project = this.owned.authority<Project>();

    const status = this.questMapper.questStatus(quest);
    if (!allowed.includes(status)) {
      const expected = allowed.map((s) => `"${s}"`).join(" or ");
      throw new BadRequestError(
        `Cannot ${action} quest ${formatReference("quest", quest.shortId)}: it is "${status}", expected ${expected}.`,
      );
    }

    return { quest, project };
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

  /**
   * A comma-separated query param, as a list of trimmed, non-empty values.
   *
   * ⚠️ Never throws and never rejects. A hand-edited link, a stale bookmark
   * or a value from a future version of the page must land on the unfiltered
   * list rather than on an error page or an empty table with no visible
   * cause. Everything unusable is dropped, so the worst outcome is a filter
   * that does nothing.
   */
  protected parseList(value: string | undefined): string[] {
    if (!value) return [];
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  /**
   * The same, restricted to values the status filter understands. An
   * unknown status is dropped rather than rejected, and duplicates are
   * collapsed so `?status=new,new` is one condition.
   */
  protected parseStatusList(value: string | undefined): QuestStatus[] {
    const known = new Set<string>(z.schema.enumValues(questStatusSchema));
    return [...new Set(this.parseList(value))].filter(
      (entry): entry is QuestStatus => known.has(entry),
    );
  }

  /**
   * The same, for a list of numeric ids. A non-numeric entry is dropped,
   * which is what keeps `?releaseId=abc` a no-op instead of a 400.
   */
  protected parseIdList(value: string | undefined): number[] {
    return [
      ...new Set(
        this.parseList(value)
          .map((entry) => Number(entry))
          .filter((entry) => Number.isInteger(entry)),
      ),
    ];
  }

  /**
   * The release filter, which is ids plus one sentinel.
   *
   * `QUEST_RELEASE_NONE` selects the quests attached to no release at all -
   * the question a release planner asks most often and the one every option
   * being a release could not answer. It rides in the same multi-value
   * parameter as the ids rather than in one of its own, because the filter's
   * selections OR together and two parameters would AND: "no release, or
   * 0.29.0" has to be expressible.
   *
   * `parseIdList` drops it on its own, since it is not an integer, which is
   * exactly why it is safe to put there.
   */
  protected parseReleaseFilter(value: string | undefined): {
    ids: number[];
    unattached: boolean;
  } {
    return {
      ids: this.parseIdList(value),
      unattached: this.parseList(value).includes(QUEST_RELEASE_NONE),
    };
  }

  /**
   * What one status means as a set of column conditions.
   *
   * Extracted because a status is not a column: each is a combination of
   * three nullable timestamps, so a multi-status filter has to OR whole
   * condition objects rather than values, and the single-status branch and
   * the OR branch must not be allowed to drift apart.
   */
  protected statusConditions(status: QuestStatus): Record<string, any> {
    switch (status) {
      case "new":
        return {
          acceptedAt: { isNull: true },
          completedAt: { isNull: true },
          shelvedAt: { isNull: true },
        };
      case "accepted":
        return {
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        };
      case "completed":
        return { completedAt: { isNotNull: true } };
      default:
        return { shelvedAt: { isNotNull: true } };
    }
  }

  /**
   * What an edit actually changed, as display-ready lines for the feed.
   *
   * Every mutation used to write one `updated` row, so uploading an
   * attachment and renaming a quest produced the same "updated the quest"
   * and two unrelated edits looked identical (feedback #2004).
   *
   * ⚠️ Only fields with something worth SAYING. A `patch` carries
   * bookkeeping too (`attachments` is rewritten on every save to fold in
   * embedded images, `completionMessageUpdatedAt` is a stamp), and a diff
   * that reported those would trade one useless line for several.
   *
   * Attachment ids are resolved to filenames here, on the server, because
   * this is the only place a REMOVED file's name still exists: by the time
   * the feed renders, it is gone from the quest.
   */
  protected async diffQuest(
    before: Quest,
    patch: Partial<Quest>,
  ): Promise<Array<{ field: string; from?: string; to?: string }>> {
    const changes: Array<{ field: string; from?: string; to?: string }> = [];

    // Narrowed rather than `unknown`: every caller passes a scalar column,
    // and a wider type would let an object through to `String()` and print
    // "[object Object]" into somebody's activity feed.
    type Scalar = string | number | null | undefined;
    const scalar = (field: string, next: Scalar, prev: Scalar) => {
      if (next === undefined || next === prev) return;
      changes.push({
        field,
        from: prev == null ? undefined : String(prev),
        to: next == null ? undefined : String(next),
      });
    };

    scalar("priority", patch.priority, before.priority);
    scalar("area", patch.area, before.area);
    scalar("size", patch.size, before.size);
    scalar("dueAt", patch.dueAt, before.dueAt);
    // Epic and release are named rather than numbered: an id says nothing to
    // a reader, and both are cheap to resolve on a field that rarely moves.
    if (patch.epicId !== undefined && patch.epicId !== before.epicId) {
      const numbers = await this.epicNumbers([patch.epicId, before.epicId]);
      changes.push({
        field: "epic",
        from: before.epicId ? numbers.get(before.epicId) : undefined,
        to: patch.epicId ? numbers.get(patch.epicId) : undefined,
      });
    }

    if (patch.releaseId !== undefined && patch.releaseId !== before.releaseId) {
      const tags = await this.releaseTags([patch.releaseId, before.releaseId]);
      changes.push({
        field: "release",
        from: before.releaseId ? tags.get(before.releaseId) : undefined,
        to: patch.releaseId ? tags.get(patch.releaseId) : undefined,
      });
    }

    if (patch.title !== undefined && patch.title !== before.title) {
      // The old title, not the new one: the new one is the heading above
      // the feed, so printing it again says nothing.
      changes.push({ field: "title", from: before.title });
    }

    if (
      patch.description !== undefined &&
      patch.description !== before.description
    ) {
      // No values. A markdown diff in a one-line feed entry is unreadable,
      // and "edited the description" is the honest whole of it.
      changes.push({ field: "description" });
    }

    const list = (
      field: string,
      next: string[] | undefined,
      prev: string[],
      label: (value: string) => string = (value) => value,
    ) => {
      if (!next) return;
      const added = next.filter((value) => !prev.includes(value));
      const removed = prev.filter((value) => !next.includes(value));
      if (added.length) {
        changes.push({ field, to: added.map(label).join(", ") });
      }
      if (removed.length) {
        changes.push({ field, from: removed.map(label).join(", ") });
      }
    };

    list("tags", patch.tags, before.tags ?? []);

    if (patch.attachments) {
      const names = await this.attachmentNames([
        ...patch.attachments,
        ...before.attachments,
      ]);
      list(
        "attachments",
        patch.attachments,
        before.attachments,
        (id) => names.get(id) ?? id,
      );
    }

    return changes;
  }

  /**
   * Per-project epic numbers for a set of epic ids, for the history lines.
   */
  protected async epicNumbers(
    ids: Array<number | undefined | null>,
  ): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => !!id))];
    if (unique.length === 0) return new Map();
    const rows = await this.epics
      .findMany({ where: { id: { inArray: unique } } })
      .catch(() => []);
    return new Map(
      rows.map((row) => [row.id, formatReference("epic", row.number)]),
    );
  }

  /**
   * Release tags for a set of release ids, for the history lines.
   */
  protected async releaseTags(
    ids: Array<number | undefined | null>,
  ): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => !!id))];
    if (unique.length === 0) return new Map();
    const rows = await this.releases
      .findMany({ where: { id: { inArray: unique } } })
      .catch(() => []);
    return new Map(rows.map((row) => [row.id, row.tag ?? String(row.number)]));
  }

  /**
   * Filenames for a set of file ids, for the history lines.
   *
   * Best effort: a file the lookup cannot resolve falls back to its id at
   * the call site rather than dropping the line, because "an attachment was
   * removed" is still true and more useful than silence.
   */
  protected async attachmentNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.fileService.fileRepository
      .findMany({ where: { id: { inArray: unique } } })
      .catch(() => []);
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * The shape a caller sends to record a commit. `at` and `by` are stamped
   * server-side, so a caller cannot backdate the trail or credit someone
   * else with it.
   */
  protected readonly commitInputSchema = questCommitSchema
    .pick({ sha: true, message: true, repo: true })
    .extend({
      sha: z
        .string()
        .regex(/^[0-9a-fA-F]{7,40}$/)
        .describe("Commit sha, 7 to 40 hex characters."),
    });

  /**
   * Append commits to a quest's trail, deduped on the sha.
   *
   * Normalized to lowercase because git prints shas in lowercase but a
   * caller may not, and a trail listing the same commit twice under two
   * casings is worse than useless. Idempotent: recording a sha the quest
   * already carries leaves the trail alone rather than erroring, so an
   * agent retrying a dropped call is safe.
   */
  protected appendCommits(
    existing: Quest["commits"],
    incoming: Array<{ sha: string; message?: string; repo?: string }>,
    userId: string,
    at: string,
  ): Quest["commits"] {
    const trail = [...(existing ?? [])];
    const seen = new Set(trail.map((commit) => commit.sha.toLowerCase()));

    for (const commit of incoming) {
      const sha = commit.sha.toLowerCase();
      if (seen.has(sha)) continue;
      seen.add(sha);
      trail.push({
        sha,
        message: commit.message?.trim() || undefined,
        repo: commit.repo?.trim() || undefined,
        at,
        by: userId,
      });
    }

    return trail;
  }

  /**
   * Record what shipped for a quest.
   *
   * Allowed on completed quests, like `completionMessage`: the trail is
   * project memory, and the sha is usually known only after the merge.
   */
  addQuestCommit = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: this.commitInputSchema,
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = this.owned.get<Quest>();

      const updated = await this.quests.updateById(params.id, {
        commits: this.appendCommits(
          quest.commits,
          [body],
          user.id,
          this.dt.nowISOString(),
        ),
      });
      await this.logQuest("commit", updated, user, { sha: body.sha });

      return this.mapQuestToResource(updated);
    },
  });

  createQuest = $action({
    use: [
      $secure({ permissions: ["quest:create"] }),
      $transactional(),
      this.ownsProjectFromBody(),
    ],
    schema: {
      body: questCreateSchema,
      response: questResourceSchema,
    },
    handler: async ({ body, user }) => {
      // The gate loaded this row to decide on it; the owner-only rule below
      // reads it back rather than querying the project again.
      const project = this.owned.authority<Project>();

      // Validate feedback link: must exist in this project, must be accepted.
      // Anyone with quest:create can pass any id otherwise, so we check here
      // and not via FK alone.
      if (body.feedbackId != null) {
        if (project.createdBy !== user.id) {
          throw new ForbiddenError(
            "Only the project owner can link a quest to a feedback item",
          );
        }
        const feedback = await this.feedback.findOne({
          where: {
            id: { eq: body.feedbackId },
            projectId: { eq: body.projectId },
          },
        });
        if (!feedback) {
          throw new BadRequestError("Feedback not found in this project");
        }
        if (feedback.status !== "accepted") {
          throw new BadRequestError(
            "Feedback must be accepted before quests can be linked",
          );
        }
      }

      // Validate optional `dependsOn` — must be in the same project and
      // cannot point at the quest itself (we don't have the shortId yet,
      // so the self-check fires on update). NULL-by-default schema means
      // `dependsOn: null` from the client clears the link.
      if (body.dependsOn != null) {
        const predecessor = await this.quests.findOne({
          where: {
            id: { eq: body.dependsOn },
            projectId: { eq: body.projectId },
          },
        });
        if (!predecessor) {
          throw new BadRequestError(
            "dependsOn quest not found in this project",
          );
        }
      }

      // Same rule as `updateQuestById`, through the same service: a quest
      // cannot be created straight into a published release, and the release
      // has to belong to this project.
      const releaseId =
        body.releaseId != null
          ? ((await this.releaseAttachment.resolve(
              body.projectId,
              undefined,
              body.releaseId,
            )) ?? undefined)
          : undefined;

      // Quest-creation mechanics (shortId sequence, area-ensure, HTML
      // sanitization, defaults) live in QuestService — the single path
      // shared with BlightController.forwardBlightToQuest.
      const quest = await this.questService.createQuest({
        projectId: body.projectId,
        releaseId,
        title: body.title,
        // Title-only quests are allowed; default the optional description to
        // "" so the NOT-NULL column never sees undefined.
        description: body.description ?? "",
        area: body.area,
        priority: body.priority,
        size: body.size,
        // `z.nullable` skips the schema's `minimum: 1`, so guard here: a
        // non-positive estimate is stored as none (the UI can't produce it).
        estimateMinutes:
          body.estimateMinutes && body.estimateMinutes > 0
            ? body.estimateMinutes
            : undefined,
        // `null` and `undefined` both mean "no deadline" on create; the
        // three-way clear only matters on update.
        dueAt: body.dueAt ?? undefined,
        objectives: body.objectives,
        attachments: await this.ownUploads(
          this.questService.mergeEmbeddedAttachments(
            [body.description],
            body.attachments ?? [],
          ),
          user,
        ),
        tags: body.tags,
        dependsOn: body.dependsOn,
        feedbackId: body.feedbackId,
        createdBy: user.id,
      });

      await this.syncQuestLinks(quest);
      await this.logQuest("create", quest, user);

      return this.mapQuestToResource(quest);
    },
  });

  /**
   * Re-sync this quest's outbound `[[...]]` links.
   *
   * Scans all three of a quest's markdown fields together — `description`,
   * `note`, `completionMessage` — because a link row records only that
   * quest #N references X, with no column for WHICH field it was written
   * in. Syncing from one field would silently drop the references in the
   * other two the moment that field was saved.
   *
   * `note` is a frozen dead column since the note feature was deleted
   * (2026-08-20): nothing writes it anymore. It stays in this scan for
   * that exact reason — a quest whose only reference to a folio was
   * written in its note would otherwise lose that link on the next
   * description save.
   *
   * Takes the stored row rather than the request body for the same reason:
   * a handler that only touches one field still has to sync against the
   * ones it did not send.
   *
   * Called from every path that writes one of those fields. Nothing
   * enforces that — a new write path that forgets simply leaves the graph
   * stale.
   */
  protected async syncQuestLinks(quest: Quest): Promise<void> {
    await this.linkService.syncLinks(
      { kind: "quest", id: quest.id, projectId: quest.projectId },
      [quest.description, quest.note, quest.completionMessage]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

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
      const file = await this.attachments.upload(body.file, { user });
      return {
        fileId: file.id,
        url: `/api/files/${file.id}`,
      };
    },
  });

  addAttachment = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
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
      const { quest } = this.getQuestForTransition(
        "attach a file to",
        // Completed included, unlike every other write on a quest: evidence
        // arrives at the END. A screenshot or a probe log proving the work
        // is what an agent has to hand once it closes the quest, and the
        // alternative is numbers pasted into prose. The quest BODY stays
        // frozen (`updateQuestById` still refuses), which is what the audit
        // record is actually protecting.
        ["new", "accepted", "shelved", "completed"],
      );

      if (quest.attachments.includes(body.fileId)) {
        return this.mapQuestToResource(quest);
      }

      // Listing an id here is what grants every member read access to the
      // bytes, so only the caller's own uploads into the quest bucket may be
      // listed: an avatar, a folio attachment or another project's attachment
      // used to become readable by naming its id.
      const [owned] = await this.ownUploads([body.fileId], user);
      if (!owned) {
        throw new NotFoundError("File not found among your uploads");
      }

      const updated = await this.quests.updateById(params.id, {
        attachments: [...quest.attachments, body.fileId],
      });
      await this.logQuest("attachment", updated, user, { added: body.fileId });

      return this.mapQuestToResource(updated);
    },
  });

  /**
   * Name and type for each of a quest's attachments, so the UI can label a
   * chip with the real filename instead of a truncated uuid.
   *
   * A quest-scoped read rather than a general file lookup: `findFiles` is
   * `admin:file:read`, and membership on the quest's project is the right
   * gate for the files hanging off it. Ids not present on the quest are
   * ignored rather than fetched, so this cannot be used to probe for
   * arbitrary files by id.
   */
  listQuestAttachments = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.array(
        z.object({
          fileId: z.uuid(),
          name: z.string(),
          mimeType: z.string(),
          size: z.integer(),
        }),
      ),
    },
    handler: async () => {
      const quest = this.owned.get<Quest>();
      const attachments = quest.attachments ?? [];
      if (attachments.length === 0) {
        return [];
      }

      // One lookup for the whole list, the same shape `attachmentNames`
      // above already uses. It replaces a `getFileById` per attachment,
      // which on D1 was a round trip each.
      const rows = await this.fileService.fileRepository.findMany({
        where: { id: { inArray: [...new Set(attachments)] } },
        columns: ["id", "name", "mimeType", "size"],
      });
      const byId = new Map(rows.map((row) => [row.id, row]));

      // A row can outlive its blob (purge job, manual delete), and one
      // missing file must not take the whole list down with it — absent
      // from the result set is exactly the old per-file catch. What it no
      // longer swallows is a FAILING lookup: that used to drop the files it
      // could not read and answer 200 with a short list, which reads as
      // "the attachment is gone".
      //
      // Driven by `attachments` rather than by `rows` so the order the
      // owner attached them in is preserved.
      return attachments.flatMap((fileId) => {
        const file = byId.get(fileId);
        return file
          ? [
              {
                fileId,
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
              },
            ]
          : [];
      });
    },
  });

  /**
   * One quest attachment's bytes (base64) plus its metadata.
   *
   * Backs the `quest_attachment_get` MCP tool, which wraps the bytes into
   * an MCP `image` content block so an agent can actually look at the
   * screenshot the owner attached. Before this existed, a file on a quest
   * was invisible to every agent working it.
   *
   * Same two gates as `FeedbackController.getFeedbackAttachment`, which is
   * the shape this copies: project membership, plus an IDOR guard that the
   * `fileId` is one of THIS quest's own attachments. Without the second, a
   * member could read any file in the system by id through a quest they
   * can see. The 10 MB storage cap bounds the base64 payload (~13.4 MB).
   */
  getQuestAttachment = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
        fileId: z.uuid(),
      }),
      response: z.object({
        id: z.uuid(),
        name: z.string(),
        mimeType: z.string(),
        size: z.integer(),
        data: z.string().describe("Base64-encoded file bytes."),
      }),
    },
    handler: async ({ params }) => {
      const quest = this.owned.get<Quest>();

      // IDOR guard: only files hanging off THIS quest are readable.
      if (!(quest.attachments ?? []).includes(params.fileId)) {
        throw new NotFoundError("Attachment not found on this quest");
      }

      const file = await this.fileService.getFileById(params.fileId).catch(
        // A row can outlive its blob (purge job, manual delete);
        // `listQuestAttachments` silently drops those, so a caller reading
        // from that list can legitimately arrive here with a dead id.
        () => undefined,
      );
      if (!file) {
        throw new NotFoundError("Attachment file missing");
      }

      const blob = await this.attachments.download(file);
      const data = Buffer.from(await blob.arrayBuffer()).toString("base64");

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        data,
      };
    },
  });

  /**
   * The subset of `ids` that are files this user uploaded into the quest
   * bucket, in the order given. Anything else is dropped: another user's
   * upload, an avatar, a folio attachment, a foreign id. Being listed in
   * `quest.attachments` is what lets every project member read the bytes
   * (see `LoreFileAccessProvider`), so a caller must not be able to list a
   * file that is not theirs.
   */
  protected async ownUploads(
    ids: string[],
    user: UserAccountToken,
  ): Promise<string[]> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) {
      return [];
    }
    const rows = await this.fileService.fileRepository.findMany({
      where: {
        id: { inArray: wanted },
        bucket: { eq: this.attachments.name },
        creator: { eq: user.id },
      },
    });
    const owned = new Set(rows.map((row) => row.id));
    return wanted.filter((id) => owned.has(id));
  }

  /**
   * Apply `ownUploads` to what a write ADDS to a quest: ids the quest
   * already lists were vetted when they were added and stay as the merge
   * left them (a patch may drop some), new ones must be the caller's own.
   */
  protected async withOwnEmbedded(
    current: string[],
    merged: string[],
    user: UserAccountToken,
  ): Promise<string[]> {
    const kept = merged.filter((id) => current.includes(id));
    const added = merged.filter((id) => !current.includes(id));
    return [...kept, ...(await this.ownUploads(added, user))];
  }

  removeAttachment = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
        fileId: z.uuid(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = this.getQuestForTransition(
        "remove an attachment from",
        ["new", "accepted", "shelved"],
      );

      // Only an id this quest lists can be removed through it. The handler
      // used to delete ANY file in the instance by id (avatars, project
      // icons, folio attachments): `FileService.deleteFile` has no owner check.
      if (!quest.attachments.includes(params.fileId)) {
        throw new NotFoundError("Attachment not found on this quest");
      }

      const updatedAttachments = quest.attachments.filter(
        (id) => id !== params.fileId,
      );

      // The bytes go only for a file of the quest bucket. An embedded image
      // can be merged into several quests (`mergeEmbeddedAttachments`), so
      // a deletion here can still break another quest's embed; that is the
      // pre-existing behaviour and a narrower problem than the one above.
      const file = await this.fileService
        .getFileById(params.fileId)
        .catch(() => undefined);
      if (file && file.bucket === this.attachments.name) {
        await this.fileService.deleteFile(file.id).catch((error) => {
          this.log.warn("Attachment bytes could not be deleted", {
            fileId: file.id,
            error,
          });
        });
      }

      const updated = await this.quests.updateById(params.id, {
        attachments: updatedAttachments,
      });
      await this.logQuest("attachment", updated, user, {
        removed: params.fileId,
      });

      return this.mapQuestToResource(updated);
    },
  });

  getQuests = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      query: pageQuerySchema.extend({
        /**
         * One status, or several comma-separated (`new,accepted`). Several
         * means the union, and an empty or unparseable value means no status
         * filter at all rather than an error - the Quests page is reachable
         * by hand-edited link and by stale bookmark, and both must land on
         * the unfiltered list (quest #1644).
         *
         * A list rather than repeated keys because
         * `ServerProvider.parseQueryString` returns `Record<string, string>`:
         * `?status=new&status=accepted` would keep only the last one.
         */
        status: z.string().optional(),
        search: z.string().optional(),
        /**
         * One release id, or several comma-separated. Kept as text for the
         * same reason `status` is: this is a query param, and the parsing
         * lives in one place below rather than in the schema for one of the
         * four and in the handler for the rest.
         */
        releaseId: z.string().optional(),
        epic: z.integer().optional(),
        includePlanned: z.boolean().optional(),
        area: z.string().optional(),
        tag: z.string().optional(),
        /**
         * Rows to skip, when `page` cannot express it.
         *
         * MCP `quest_list` offers a raw `offset` and used to convert it to a
         * page with integer division, so `offset: 25, limit: 20` silently
         * returned rows 20-39 - the tool answered a question next to the one
         * it was asked, and an agent paging by anything other than a multiple
         * of its own limit re-read rows it had already seen.
         *
         * Wins over `page` when both are given, because it is the more
         * specific of the two.
         */
        offset: z.integer().min(0).optional(),
      }),
      response: db.page(questResourceSchema),
    },
    handler: async ({ params, query, user }) => {
      const where = this.quests.createQueryWhere();
      where.projectId = { eq: params.projectId };

      if (query.search) {
        // ID-by-search: a bare integer or `#N` form means "find this
        // specific quest by its per-project shortId" (Lore #94 — UX
        // shortcut for typing #42 into the same search box). Anything
        // else stays title `ilike`.
        const idMatch = query.search.trim().match(/^#?(\d+)$/);
        if (idMatch) {
          where.shortId = { eq: Number.parseInt(idMatch[1], 10) };
        } else {
          where.title = { ilike: `%${query.search}%` };
        }
      }

      // Every multi-value filter is OR'd within itself and AND'd against the
      // others, so `status=new,accepted` + `area=a,b` reads as "(new or
      // accepted) and (area a or b)". The groups collect here because `where`
      // itself carries only one `or`.
      const groups: Array<Record<string, any>> = [];

      const release = this.parseReleaseFilter(query.releaseId);
      if (release.unattached && release.ids.length > 0) {
        // "No release" OR'd with named ones, through the same `groups` array
        // the tag filter uses - `where` itself carries only one `or`.
        groups.push({
          or: [
            { releaseId: { isNull: true } },
            release.ids.length === 1
              ? { releaseId: { eq: release.ids[0] } }
              : { releaseId: { inArray: release.ids } },
          ],
        });
      } else if (release.unattached) {
        where.releaseId = { isNull: true };
      } else if (release.ids.length === 1) {
        where.releaseId = { eq: release.ids[0] };
      } else if (release.ids.length > 1) {
        where.releaseId = { inArray: release.ids };
      }

      if (query.epic) {
        where.epicId = { eq: query.epic };
      }

      const areas = this.parseList(query.area);
      if (areas.length === 1) {
        where.area = { eq: areas[0] };
      } else if (areas.length > 1) {
        where.area = { inArray: areas };
      }

      const tags = this.parseList(query.tag);
      if (tags.length > 0) {
        // tags are stored as a JSON array; LIKE the serialized form
        // matches an exact (normalized) value. Mirrors folio tag search.
        // A quest matching ANY of the asked-for tags qualifies, which is the
        // same reading the other three filters get.
        groups.push({
          or: tags.map((tag) => ({
            tags: { like: `%"${tag.toLowerCase()}"%` },
          })),
        });
      }

      const statuses = this.parseStatusList(query.status);
      if (statuses.length === 0) {
        // No status filter means "everything I still care about" — shelved
        // quests are deliberately out of scope, so they only ever surface
        // through the explicit `shelved` filter. An empty list and an absent
        // filter are the same question: selecting nothing cannot mean
        // "show nothing", and selecting all four means the same as neither.
        where.shelvedAt = { isNull: true };
      } else if (statuses.length === 1) {
        Object.assign(where, this.statusConditions(statuses[0]));
        // A default sort belongs to ONE chosen status. With several selected
        // there is no single date the list is about, so `-updatedAt` stands.
        if (statuses[0] === "completed") query.sort ??= "-completedAt";
        if (statuses[0] === "shelved") query.sort ??= "-shelvedAt";
      } else {
        groups.push({
          or: statuses.map((status) => this.statusConditions(status)),
        });
      }

      if (groups.length > 0) {
        where.and = groups as any;
      }

      // Quests of a `planned` epic are specified but not released into the
      // backlog. This FILTERS; it never mutates a quest row.
      //
      // Two ways past it, and both are deliberate. `includePlanned` is the
      // explicit opt-out, set by the pickers that need the whole project
      // (`EpicQuestPicker`, `QuestDependencyPicker`) and, since epic #31,
      // offered by MCP `quest_list` as an optional parameter that defaults
      // OFF, so the tool and the UI list the same backlog unless asked
      // otherwise. `epic` is the implicit one: a caller addressing one epic
      // is looking at that epic's own quests, planned or not, which is what
      // lets an agent that just filed a quest into a planned epic read it
      // back without any flag.
      //
      // `includePlanned` is client-settable and that is fine — every caller
      // has already passed the membership gate, so it exposes nothing the
      // caller could not already read. This is a backlog-organisation
      // affordance, NOT an authorization control. Do not "harden" it into one.
      if (!query.includePlanned && !query.epic) {
        await this.epicVisibility.applyBacklogGate(where, params.projectId);
      }

      query.sort ??= "-updatedAt";

      const result = await this.quests.paginate(
        query,
        {
          where,
          // Passed through rather than folded into `page`: `paginate` already
          // prefers `query.offset` over `page * limit`.
          ...(query.offset !== undefined ? { offset: query.offset } : {}),
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
   * Open-quest count for the sidebar badge. "Open" is everything neither
   * completed nor shelved — the same "still needs attention" meaning the
   * blight and feedback badges carry, so all three numbers read the same way.
   *
   * Shelved quests are deliberately out of scope, and the list this badge
   * links to already hides them, so counting them made the sidebar disagree
   * with the page it opens.
   *
   * Readable by any project member.
   */
  countOpenQuests = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    path: "/projects/:projectId/quests/count",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ params }) => {
      // `OpenQuestScope` owns what "open" means. This badge links to the
      // quest list, and the dashboard counts the same thing on the same
      // screen — an ungated or differently-gated count here reproduces
      // exactly the disagreement an e2e run once caught (badge said 2, list
      // showed none).
      const where = await this.openQuests.where([params.projectId]);

      const count = await this.quests.count(where);

      return { count };
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
   * Everything the questline page needs, in one answer: whether this quest
   * belongs to an epic, and if it does not, the quests it is connected to.
   *
   * ## Why the two live on one call
   *
   * The page's whole job is a fork - a quest inside an epic is sent to that
   * epic's Flow tab, a quest outside one draws its own questline here - and
   * the fork is decided by data the client does not have. Answering it in a
   * second round trip would mean a page that renders, then navigates away.
   * When `epic` comes back set, `quests` is deliberately empty: the caller is
   * leaving, and building a component for it would be work thrown away.
   *
   * `epic` carries the per-project `number`, not the id, because that is what
   * the route is addressed by (`/epics/:epicNumber`). The quest row has only
   * `epicId`, so a client resolving this itself would need the epic list.
   *
   * ## Why the component is walked here
   *
   * "The quests connected to this one through `dependsOn`" is not a `WHERE`.
   * It is a graph walk, and the alternatives both cost more: walking it in
   * the browser needs the project's whole edge list shipped first (what the
   * retired `getDependencyGraph` did), and that edge list was too thin to
   * draw with - `Questline` reads `area` and `metadata`, so a second fetch
   * for the real rows followed.
   *
   * Two queries: the edge list to find the component, then the component's
   * rows in full. The first is deliberately `columns`-narrowed, since it is
   * read entirely to be thrown away.
   */
  getQuestline = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    path: "/projects/:projectId/quests/:shortId/questline",
    schema: {
      params: z.object({
        projectId: z.integer(),
        shortId: z.integer(),
      }),
      response: z.object({
        /**
         * Set when the quest belongs to an epic, which is the signal to open
         * that epic's Flow tab instead of drawing anything here.
         */
        epic: z
          .object({
            number: z.integer(),
            title: z.string(),
          })
          .optional(),
        /**
         * The connected `dependsOn` component containing this quest, the
         * quest itself included - so a quest with no relations comes back
         * alone rather than empty, and "no questline" stays distinguishable
         * from "could not read it".
         *
         * Empty when `epic` is set, and only then.
         */
        quests: z.array(questResourceSchema),
      }),
    },
    handler: async ({ params }) => {
      const focus = await this.quests.getOne({
        where: {
          projectId: { eq: params.projectId },
          shortId: { eq: params.shortId },
        },
      });

      if (focus.epicId != null) {
        const epic = await this.epics.findOne({
          where: { id: { eq: focus.epicId } },
        });
        // A missing epic row is not a reason to refuse: `quests.epicId` is a
        // real FK, so this is unreachable, and falling through to the
        // questline is a better answer than a 500 if it ever is not.
        if (epic) {
          return {
            epic: { number: epic.number, title: epic.title },
            quests: [],
          };
        }
      }

      const edges = await this.quests.findMany({
        where: { projectId: { eq: params.projectId } },
        columns: ["id", "dependsOn"],
      });

      const component = this.connectedQuests(edges, focus.id);

      // `inArray: []` throws, and cannot happen: `connectedQuests` always
      // returns at least the quest it started from.
      const rows = await this.quests.findMany({
        where: { id: { inArray: [...component] } },
      });

      return { quests: rows.map((row) => this.mapQuestToResource(row)) };
    },
  });

  /**
   * The ids reachable from `startId` through `dependsOn`, in either
   * direction, `startId` included.
   *
   * ⚠️ Undirected on purpose. What blocks a quest and what it unblocks are
   * both part of the questline the reader is looking at, and following only
   * the `dependsOn` direction would draw the chain above the quest while
   * hiding everything the quest itself unblocks.
   */
  protected connectedQuests(
    edges: Array<{ id: number; dependsOn?: number | null }>,
    startId: number,
  ): Set<number> {
    const neighbours = new Map<number, Set<number>>();
    const link = (from: number, to: number) => {
      const set = neighbours.get(from) ?? new Set<number>();
      set.add(to);
      neighbours.set(from, set);
    };

    for (const edge of edges) {
      if (edge.dependsOn == null) continue;
      link(edge.id, edge.dependsOn);
      link(edge.dependsOn, edge.id);
    }

    const seen = new Set<number>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      for (const next of neighbours.get(queue.shift()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    return seen;
  }

  getQuestLine = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsQuest()],
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
    handler: async ({ params }) => {
      const quest = this.owned.get<Quest>();

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
   * Return the distinct set of tags used by any quest in a project —
   * fuel for chip autocomplete in the editor and the filter dropdown.
   * Mirrors `FolioController.listTags` but scope is project-level (tags
   * are a property of the project's quest taxonomy, not the user's).
   */
  listQuestTags = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      this.ownsProjectFromQuery(),
    ],
    description: "Return the distinct set of tags used in a project.",
    schema: {
      query: z.object({ projectId: z.integer() }),
      response: z.array(z.string()),
    },
    handler: async ({ query }) => {
      const rows = await this.quests.findMany({
        where: { projectId: { eq: query.projectId } },
        columns: ["tags"],
      });
      const tags = new Set<string>();
      for (const row of rows) {
        for (const tag of row.tags ?? []) tags.add(tag);
      }
      return [...tags].sort();
    },
  });

  /**
   * Hand an accepted quest back to the backlog as "new".
   *
   * Deliberately NOT behind the epic phase gate (epic #31), for the reason
   * `shelveQuest` is not: unassigning is the step before shelving, and both
   * move a quest toward resolution rather than opening work.
   */
  abandonQuest = $action({
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = this.getQuestForTransition("abandon", ["accepted"]);

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
      await this.logQuest("unassign", quest, user);
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
   *
   * Deliberately NOT behind the epic phase gate (epic #31). Shelving moves
   * a quest toward resolution, and it is the only exit for a `new` quest
   * sitting in a concluded epic from before that rule existed.
   */
  shelveQuest = $action({
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      // "shelved" is allowed so re-shelving stays idempotent below.
      const { quest } = this.getQuestForTransition("shelve", [
        "new",
        "shelved",
      ]);

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
      await this.logQuest("shelve", quest, user);
      return this.mapQuestToResource(quest);
    },
  });

  /**
   * Bring a shelved quest back into the backlog as "new".
   */
  unshelveQuest = $action({
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = this.getQuestForTransition("unshelve", ["shelved"]);
      // Re-opening work inside a concluded epic is refused; unshelving
      // inside a planned one is allowed, since that edits an open plan.
      await this.epicWorkflow.assertQuestWorkable(quest, "unshelve");

      quest.shelvedAt = undefined;
      quest.shelvedBy = undefined;
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "unshelved",
      });

      await this.quests.save(quest);
      await this.logQuest("unshelve", quest, user);
      return this.mapQuestToResource(quest);
    },
  });

  acceptQuest = $action({
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      // "shelved" is allowed on purpose — see the un-shelving branch below.
      const { quest, project } = this.getQuestForTransition("accept", [
        "new",
        "shelved",
      ]);

      // Epic phase gate (epic #31), BEFORE the questline gate: a quest can
      // be accepted only while its epic is active, and of the two reasons
      // this is the one fixed by a single click somewhere else.
      await this.epicWorkflow.assertQuestWorkable(quest, "accept");

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
            `Cannot accept quest: blocked by ${formatReference("quest", predecessor.shortId)}`,
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
      if (project.features?.kanban) {
        quest.kanbanColumn = project.kanbanColumns?.[0];
      }
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "assigned",
      });

      await this.quests.save(quest);
      await this.logQuest("accept", quest, user);
      return this.mapQuestToResource(quest);
    },
  });

  /**
   * Undo a completion.
   *
   * A completed quest used to be terminal — no endpoint could reverse it,
   * and the board refused to drag its card out of Done. Correct for a log,
   * wrong for a board, where pulling something back out of Done is routine.
   *
   * `completionMessage` is deliberately KEPT. It is project memory, it has
   * a visible home in the Discussion feed as the completion-summary entry,
   * and deleting it would destroy the account of work that really did
   * happen. Completing again overwrites it.
   *
   * The card returns to the FIRST sub-column rather than to whichever one
   * it was completed from: the old column is not stored (`completeQuest`
   * does not preserve it), and inventing one would put a reopened card in a
   * lane nobody moved it to. First column is where a freshly accepted quest
   * lands, which is what a reopened one is.
   */
  reopenQuest = $action({
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest, project } = this.getQuestForTransition("reopen", [
        "completed",
      ]);
      // A concluded epic's quest stays closed: the board reaches this by
      // dragging a card out of Done, and a done epic's cards ARE on the
      // board (the backlog gate hides planned epics only).
      await this.epicWorkflow.assertQuestWorkable(quest, "reopen");

      quest.completedAt = undefined;
      quest.completedBy = undefined;
      // Back to whoever held it. `completeQuest` leaves `acceptedBy` set, so
      // a reopened quest returns to its assignee rather than to nobody.
      if (project.features?.kanban) {
        quest.kanbanColumn = project.kanbanColumns?.[0];
      }
      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "reopened",
      });

      await this.quests.save(quest);
      await this.logQuest("reopen", quest, user);
      return this.mapQuestToResource(quest);
    },
  });

  /**
   * Hand a quest to another member.
   *
   * `acceptQuest` is self-assignment and always will be — it is the "I am
   * picking this up" gesture. This is the other half a board needs: work
   * moving between people. Membership-gated on BOTH sides, the caller
   * through `getQuestForTransition` and the target through
   * `isMemberById`, so a quest cannot be parked on somebody who cannot
   * see the project.
   *
   * Accepted from `new`, `shelved` and `accepted`: assigning is how a
   * shelved idea comes back with an owner, and reassigning an already
   * accepted quest is the whole point.
   */
  assignQuest = $action({
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        userId: z.uuid(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest, project } = this.getQuestForTransition("assign", [
        "new",
        "shelved",
        "accepted",
      ]);

      // Assigning makes a quest accepted without going through
      // `acceptQuest`, so it answers to the same epic phase gate.
      await this.epicWorkflow.assertQuestWorkable(quest, "assign");

      if (!(await this.security.isMemberById(quest.projectId, body.userId))) {
        throw new BadRequestError(
          "Cannot assign quest: that user is not a member of this project.",
        );
      }

      const previous = quest.acceptedBy;
      if (previous === body.userId) {
        // Already theirs. Returning the quest unchanged rather than
        // writing a second `assigned` row keeps the history readable.
        return this.mapQuestToResource(quest);
      }

      // A running timer belongs to whoever was working, and a session
      // carries no user of its own — leaving it open would bill the new
      // assignee for the old one's time, in one unsplittable span.
      const running = quest.timerSessions?.[quest.timerSessions.length - 1];
      if (running && !running.stoppedAt) {
        running.stoppedAt = this.dt.nowISOString();
      }

      // Reminders are a per-user nudge (`setQuestReminder` is gated on
      // `acceptedBy === user.id`), so they do not travel with the quest.
      // Same reasoning `abandonQuest` already applies: the alternative is
      // emailing somebody about work that is no longer theirs.
      quest.reminderInterval = undefined;
      quest.reminderNextAt = undefined;

      quest.acceptedBy = body.userId;
      quest.acceptedAt = quest.acceptedAt ?? this.dt.nowISOString();
      // Coming off the shelf, for the same reason accepting does it.
      if (quest.shelvedAt) {
        quest.shelvedAt = undefined;
        quest.shelvedBy = undefined;
        quest.history.push({
          at: this.dt.nowISOString(),
          by: user.id,
          action: "unshelved",
        });
      }
      if (project.features?.kanban && !quest.kanbanColumn) {
        quest.kanbanColumn = project.kanbanColumns?.[0];
      }

      quest.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "assigned",
        // Names the recipient, so the feed reads "X assigned this to Y"
        // rather than the "X took this" that a self-accept writes.
        targetUserId: body.userId,
      });

      await this.quests.save(quest);
      await this.logQuest("assign", quest, user, { assigneeId: body.userId });
      return this.mapQuestToResource(quest);
    },
  });

  setQuestKanbanColumn = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
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
      const { quest, project } = this.getQuestForTransition("move", [
        "accepted",
      ]);
      const columns = project.kanbanColumns ?? [];
      if (!columns.includes(body.kanbanColumn)) {
        throw new BadRequestError("Unknown kanban column for this project.");
      }
      const moved = quest.kanbanColumn !== body.kanbanColumn;
      quest.kanbanColumn = body.kanbanColumn;
      if (moved) {
        // Stamped so card aging has an honest clock. `updatedAt` is not one:
        // it moves on every edit, so a card being discussed would look
        // freshly moved and a stalled one with a typo fix would look tended.
        quest.history.push({
          at: this.dt.nowISOString(),
          by: user.id,
          action: "moved",
          column: body.kanbanColumn,
        });
      }
      await this.quests.save(quest);
      return this.mapQuestToResource(quest);
    },
  });

  /**
   * Configure (or clear) the periodic reminder for an accepted quest.
   * Only the assignee can set their own reminder — it's a per-user
   * nudge, not a project-wide notification. `interval: null` clears
   * any existing reminder; passing a preset schedules the next send
   * at `now + REMINDER_INTERVAL_MS[interval]` and the `QuestJobs`
   * nightly sweep advances from there.
   */
  setQuestReminder = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
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
      const { quest, project } = this.getQuestForTransition(
        "set a reminder on",
        ["accepted"],
      );

      if (quest.acceptedBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest's assignee can set its reminder",
        );
      }

      // Reminders are an owner-controlled module toggle. Disabling
      // (interval=null) is always allowed so a project that turned the
      // module off can still clear pre-existing reminders.
      if (body.interval != null && !project.features?.questReminder) {
        throw new ForbiddenError(
          "Quest Reminder is disabled for this project.",
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
    // Transactional so two concurrent completions cannot both pass the
    // `completedAt IS NULL` read.
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
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
        /**
         * Objectives being closed WITHOUT having been done, each with the
         * reason. They stay unticked and carry the reason on the record.
         *
         * Half the objectives on a real quest are manual ("walk the plateau
         * in the live adventure"), and the all-ticked gate used to leave two
         * options: tick a box for work you did not do, or leave a finished
         * quest open. A false tick is the worse of the two, because nothing
         * downstream can tell it from a real one.
         *
         * Only accepted here, never on `updateQuest`: waiving is part of
         * closing, and a reason written at the moment of skipping says more
         * than any up-front classification of the objective could.
         */
        waive: z
          .array(
            z.object({
              objectiveId: z.integer().min(0),
              reason: z.string().min(1),
            }),
          )
          .optional(),
        /**
         * What shipped. Closing a quest and recording the commits is the
         * call the caller is already making, so this is the natural place
         * for it; `addQuestCommit` covers the sha that only turns up after
         * the merge.
         */
        commits: z.array(this.commitInputSchema).optional(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest } = this.getQuestForTransition("complete", ["accepted"]);
      // Unreachable once the clean-conclude rule holds (a done epic has no
      // accepted quest), but rows that pre-date epic #31 can still be here,
      // and the refusal has to be right for them too.
      await this.epicWorkflow.assertQuestWorkable(quest, "complete");

      const now = this.dt.nowISOString();

      // Backfill ids before addressing anything by id, same invariant
      // `completeObjective` keeps: what is read out of `objectives` goes
      // back in with stable ids.
      const objectives = this.ensureObjectiveIds(quest.objectives);
      const waivedEvents: Quest["history"] = [];

      for (const waiver of body?.waive ?? []) {
        const target = objectives.find((o) => o.id === waiver.objectiveId);
        if (!target) {
          throw new BadRequestError(
            `Cannot waive objective ${waiver.objectiveId}: quest ${formatReference("quest", quest.shortId)} has no such objective.`,
          );
        }
        if (target.completed) {
          throw new BadRequestError(
            `Cannot waive objective ${waiver.objectiveId} ("${target.title}"): it is already completed. A waiver records work that was NOT done.`,
          );
        }
        const reason = waiver.reason.trim();
        if (!reason) {
          throw new BadRequestError(
            `Cannot waive objective ${waiver.objectiveId} ("${target.title}") without a reason.`,
          );
        }
        target.waivedReason = reason;
        target.waivedBy = user.id;
        target.waivedAt = now;
        waivedEvents.push({
          at: now,
          by: user.id,
          action: "objective_waived",
          objectiveId: target.id,
        });
      }

      // Ticked or waived closes an objective; anything else still blocks.
      const blocking = objectives.filter(
        (obj) => !obj.completed && !obj.waivedReason,
      );
      if (blocking.length > 0) {
        const named = blocking
          .map((obj) => `${obj.id} ("${obj.title}")`)
          .join(", ");
        throw new BadRequestError(
          `Cannot complete quest: ${blocking.length} objective(s) are neither completed nor waived: ${named}. Tick what was done, and pass the rest in \`waive\` with a reason.`,
        );
      }

      quest.objectives = objectives;
      if (waivedEvents.length > 0) {
        quest.history = [...quest.history, ...waivedEvents];
      }
      if (body?.commits?.length) {
        quest.commits = this.appendCommits(
          quest.commits,
          body.commits,
          user.id,
          now,
        );
      }

      quest.completedAt = now;
      quest.completedBy = user.id;
      quest.kanbanColumn = undefined;
      // Reminders auto-stop when the quest is done (see Lore #42).
      quest.reminderInterval = undefined;
      quest.reminderNextAt = undefined;
      const message = body?.message?.trim();
      if (message) {
        quest.completionMessage = message;
        quest.completionMessageUpdatedAt = now;
        // Embedded editor images become quest attachments so every
        // member can read them (see mergeEmbeddedAttachments); only the
        // caller's own uploads qualify, like everywhere else.
        quest.attachments = await this.withOwnEmbedded(
          quest.attachments,
          this.questService.mergeEmbeddedAttachments(
            [message],
            quest.attachments,
          ),
          user,
        );
      }

      await this.quests.save(quest);
      await this.syncQuestLinks(quest);
      await this.logQuest("complete", quest, user);

      return this.mapQuestToResource(quest);
    },
  });

  getQuestById = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async () => this.mapQuestToResource(this.owned.get<Quest>()),
  });

  getQuestByShortId = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    path: "/projects/:projectId/quests/:shortId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        shortId: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params }) => {
      const quest = await this.quests.getOne({
        where: {
          projectId: { eq: params.projectId },
          shortId: { eq: params.shortId },
        },
      });

      return this.mapQuestToResource(quest);
    },
  });

  updateQuestById = $action({
    // Transactional since `expectedUpdatedAt` landed: the version check is
    // a read followed by a write, and outside a transaction two concurrent
    // updates carrying the same token both read the old `updatedAt`, both
    // pass, and the later one silently wins anyway, which is the exact
    // failure the parameter exists to prevent. Same reasoning as
    // `completeQuest`'s.
    use: [
      $secure({ permissions: ["quest:update"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: quests.schema
        .pick({
          title: true,
          description: true,
          area: true,
          priority: true,
          size: true,
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
          /**
           * The release this quest ships in. `null` detaches it.
           *
           * Same three-way shape as `dependsOn`: picking it from the entity
           * schema would emit `optional<integer>` only, and there would be no
           * way to take a quest back out of a release.
           */
          releaseId: z.integer().nullable().optional(),
          // `feedbackId` links this quest back to an accepted feedback item
          // (what the feedback inbox's "linked quests" reads). `null` clears
          // the link; integer sets it. Owner-only + accepted-feedback checks
          // in the handler, mirroring `createQuest`.
          feedbackId: z.integer().nullable().optional(),
          // Optional time estimate (minutes). `null` clears the column,
          // integer sets it; the generic `patch = { ...body }` spread below
          // applies it as-is (set / clear / leave-unchanged).
          estimateMinutes: z.integer().min(1).nullable().optional(),
          // Optional deadline. Same three-way shape as `estimateMinutes`:
          // `null` clears the column, a datetime sets it, omitted leaves it
          // alone. Picking from the entity schema would collapse that to
          // set-or-leave and there would be no way to remove a due date.
          dueAt: z.datetime().nullable().optional(),
          // Overrides the bare `z.string()` picked from `quests.schema` —
          // mirrors `areas.name`'s `.max(48)` so a too-long area is a clean
          // 400 from THIS schema, not a 500 thrown out of `ensureArea`.
          area: z.string().max(48).optional(),
          /**
           * Optimistic concurrency, opt-in: the `updatedAt` the caller last
           * read. If the row has moved since, the update is refused with a
           * 409 instead of quietly overwriting whatever the other writer
           * put there.
           *
           * Never required. Two writers on one project is a when, not an
           * if, but a caller that deliberately wants last-write-wins is
           * still allowed to omit this, and every existing client does.
           */
          expectedUpdatedAt: z.datetime().optional(),
        }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = this.owned.get<Quest>();
      const project = this.owned.authority<Project>();

      // Narrower than the gate above, and about the QUEST rather than the
      // project: membership lets you read it, authorship or project
      // ownership lets you rewrite it.
      if (quest.createdBy !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or project owner can edit this quest",
        );
      }

      // Checked before anything is validated or written, and inside this
      // action's transaction. `history.at(-1)` costs nothing (the row is
      // already loaded) and turns "someone changed it" into something the
      // caller can act on.
      if (
        body.expectedUpdatedAt != null &&
        body.expectedUpdatedAt !== quest.updatedAt
      ) {
        const last = quest.history.at(-1);
        throw new ConflictError(
          `Quest ${formatReference("quest", quest.shortId)} changed since you read it: its updatedAt is ${quest.updatedAt}, you passed ${body.expectedUpdatedAt}${
            last ? ` (last change: ${last.action})` : ""
          }. Re-read the quest before writing.`,
        );
      }

      // ⚠️ The cap is "may not GROW past ten", not "may not BE over ten",
      // and the difference is the whole reason this is a handler check
      // rather than a `.max()` on the schema beside `createQuest`'s.
      //
      // Quests already exist above the cap. Renaming one sends its whole
      // objective array back unchanged, so a flat cap would refuse an edit
      // that adds nothing — and there would be no way to shrink it either,
      // leaving a quest nobody can touch. Ticking an objective and
      // completing the quest go through other endpoints entirely and never
      // reach this.
      if (
        body.objectives &&
        exceedsObjectiveCap(body.objectives.length, quest.objectives.length)
      ) {
        throw new BadRequestError(objectiveCapMessage(body.objectives.length));
      }

      if (quest.completedAt) {
        const otherEdits = Object.entries(body).filter(
          ([key, value]) =>
            !this.editableAfterCompletion.has(key) &&
            // A concurrency token is not an edit: passing it alongside a
            // completionMessage rewrite must not read as trying to change
            // the frozen body.
            key !== "expectedUpdatedAt" &&
            value !== undefined,
        );
        if (otherEdits.length > 0) {
          throw new BadRequestError(
            `Only ${[...this.editableAfterCompletion].join(", ")} can be edited on a completed quest`,
          );
        }
      }

      // The `areas` table is the sole source of truth for the list.
      // `projects.areas` is `@deprecated` and nothing reads or writes it.
      // Only fires when this update actually carries an `area` — an
      // update that leaves the field alone (`undefined`) must not
      // register anything.
      //
      // Deliberately NOT wrapped in `$transactional()`, unlike
      // `QuestService.createQuest` (whose JSDoc requires one for its
      // `shortId` sequence allocation). If a later validation below this
      // point throws — `dependsOn` pointing at itself, an unaccepted
      // feedback link — the area row this call created stays committed
      // even though the quest patch never lands. That's a fine state to
      // be in, not a bug: a zero-quest area is a legal row (an owner can
      // rename or delete it from the areas settings page), not a
      // dangling reference the way an orphaned quest FK would be.
      // Store what `ensureArea` actually persisted (trimmed), not the raw
      // body value — otherwise `area: " foo "` registers the row `foo`
      // while the quest keeps pointing at `" foo "`, matching no row. A
      // blank/whitespace-only value clears the field (ensureArea no-ops on
      // it) rather than leaving stray whitespace on the quest.
      let ensuredArea: Awaited<ReturnType<typeof this.areaService.ensureArea>>;
      if (body.area !== undefined) {
        ensuredArea = await this.areaService.ensureArea(
          quest.projectId,
          body.area,
        );
      }

      const patch: Record<string, unknown> = { ...body };
      // A precondition, not a column.
      delete patch.expectedUpdatedAt;
      if (body.area !== undefined) {
        patch.area = ensuredArea?.name ?? body.area.trim();
      }
      // An objectives replace is an EDIT, not a fresh array: items that
      // carry an id keep it, items that do not get a new one minted above
      // the highest in use. Writing `body.objectives` straight through
      // instead left ids off whatever the caller omitted, and the next read
      // re-derived them by array position, so reordering or dropping one
      // silently repointed every `objective_completed` history row at a
      // different objective.
      if (body.objectives !== undefined) {
        patch.objectives = this.ensureObjectiveIds(body.objectives);
      }
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
              projectId: { eq: quest.projectId },
            },
          });
          if (!predecessor) {
            throw new BadRequestError(
              "dependsOn quest not found in this project",
            );
          }
          patch.dependsOn = body.dependsOn;
        }
      }
      // Link / unlink a feedback item. Same guard as `createQuest`: only the
      // project owner may link, and only to a feedback item that exists in
      // this project and is already accepted. `null` clears the link.
      if (body.feedbackId !== undefined) {
        if (body.feedbackId === null) {
          patch.feedbackId = null;
        } else {
          if (project.createdBy !== user.id) {
            throw new ForbiddenError(
              "Only the project owner can link a quest to a feedback item",
            );
          }
          const feedback = await this.feedback.findOne({
            where: {
              id: { eq: body.feedbackId },
              projectId: { eq: quest.projectId },
            },
          });
          if (!feedback) {
            throw new BadRequestError("Feedback not found in this project");
          }
          if (feedback.status !== "accepted") {
            throw new BadRequestError(
              "Feedback must be accepted before quests can be linked",
            );
          }
          patch.feedbackId = body.feedbackId;
        }
      }
      // Attach to / detach from a release. The refusal on a PUBLISHED
      // release lives in the service, not here: three other write paths need
      // the same rule and a copy in each is how they drift apart.
      if (body.releaseId !== undefined) {
        patch.releaseId = await this.releaseAttachment.resolve(
          quest.projectId,
          quest.releaseId,
          body.releaseId,
        );
      }
      if (
        body.completionMessage !== undefined &&
        body.completionMessage !== quest.completionMessage
      ) {
        patch.completionMessageUpdatedAt = this.dt.nowISOString();
      }
      // Markdown carried by this patch may embed editor-uploaded images —
      // fold their file ids into attachments so members can read them.
      patch.attachments = await this.withOwnEmbedded(
        quest.attachments,
        this.questService.mergeEmbeddedAttachments(
          [body.description, body.completionMessage],
          (patch.attachments as string[] | undefined) ?? quest.attachments,
        ),
        user,
      );
      // On a completed quest most of what could be edited is frozen, so an
      // "updated" entry usually says nothing and used to be skipped outright.
      // Since #1702 the release can still move, and that IS history: which
      // release something shipped in is exactly the kind of thing somebody
      // reconstructs months later. So the entry is written when the diff
      // found something - which keeps a summary-only edit silent, as before,
      // and records the release change.
      //
      // An open quest keeps appending unconditionally: "somebody touched
      // this" is itself worth a line while the quest is live.
      const changes = await this.diffQuest(quest, patch);
      if (!quest.completedAt || changes.length > 0) {
        patch.history = [
          ...quest.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
            changes,
          },
        ];
      }

      const updated = await this.quests.updateById(params.id, patch);
      await this.syncQuestLinks(updated);
      // The field NAMES only, never the values. `diffQuest` carries `from` /
      // `to` for the quest's own history, which is member-gated behind the
      // quest; an audit row is read on a page listing every project the
      // reader belongs to, and a description's before-and-after has no
      // business being duplicated there. The names are what the feed prints.
      await this.logQuest("update", updated, user, {
        fields: changes.map((change) => change.field),
      });

      return this.mapQuestToResource(updated);
    },
  });

  completeObjective = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
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
      const { quest } = this.getQuestForTransition("tick an objective on", [
        "accepted",
      ]);

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
      await this.logQuest("objective", updated, user, {
        objectiveId: target.id,
        completed: target.completed,
      });

      return this.mapQuestToResource(updated);
    },
  });

  updateQuestObjectives = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        objectives: z.array(
          z.object({
            /**
             * The id this objective already has. Optional so the web
             * editor can add a row without inventing one, but a caller
             * that HAS the id must send it back: `ensureObjectiveIds`
             * treats an array with no ids at all as legacy and numbers it
             * by position, which repoints every `objective_completed`
             * history row at whatever now sits at that index.
             */
            id: z.integer().min(0).optional(),
            title: z.string(),
            completed: z.boolean(),
          }),
        ),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const { quest, project } = this.getQuestForTransition(
        "edit the objectives of",
        ["new", "accepted", "shelved"],
      );

      if (quest.createdBy !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or project owner can edit objectives",
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
            // The one edit whose field is known without a diff.
            changes: [{ field: "objectives" }],
          },
        ],
      });
      await this.logQuest("objective", updated, user, { edited: true });

      return this.mapQuestToResource(updated);
    },
  });

  deleteQuest = $action({
    // The only quest mutation that lacked this, and it writes three times
    // before the row goes: it clears dependents' `dependsOn`, hands any
    // forwarded blight back to the inbox, then deletes. A failure partway
    // through used to leave those first two committed against a quest that
    // still exists — dependencies silently severed, a blight reopened next to
    // the quest still tracking it.
    use: [
      $secure({ permissions: ["quest:delete"] }),
      $transactional(),
      this.ownsQuest(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const quest = this.owned.get<Quest>();
      const project = this.owned.authority<Project>();

      // Same narrowing as `updateQuestById`: membership is the gate,
      // authorship or project ownership is what allows the delete.
      if (quest.createdBy !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or project owner can delete this quest",
        );
      }

      // The plan freeze (epic #31): a quest leaves a frozen plan by being
      // shelved, never by being deleted, or "no quest leaves the plan" would
      // hold against detach and not against delete. Free while planned.
      await this.epicWorkflow.assertQuestDeletable(quest);

      // Clear dependents' `dependsOn` so the dependency graph does not keep
      // edges to a deleted quest. `null`, not `undefined`: the repository
      // strips undefined keys from an update, which made this a no-op.
      //
      // One statement rather than a read plus an update per dependent: on
      // D1 each of those was a round trip, inside a delete that is already
      // transactional.
      await this.quests.updateMany(
        { dependsOn: { eq: params.id } },
        { dependsOn: null },
      );

      // Hand the blight back to the inbox before its quest disappears.
      //
      // `blight_forward` is one-way — it refuses a blight already carrying a
      // `quest:` status — so without this the row is stranded: invisible in the
      // inbox because its status is not `open`, un-forwardable because it looks
      // handled, and pointing at a quest that 404s. The failure it reported
      // goes on happening with nothing left to surface it.
      //
      // Reopening here does not contradict the rule that a triage decision
      // survives the next batch (see `absorbErrors`). That rule protects a
      // decision from being undone by NOISE; deleting the quest is the owner
      // deliberately withdrawing the decision, which is the opposite.
      if (quest.source?.sigilBlightId) {
        const blight = await this.blights.findById(quest.source.sigilBlightId);
        // Only if it still points HERE. A blight re-forwarded to another quest
        // belongs to that one now, and must not be reopened by this delete.
        if (blight?.status === `${QUEST_STATUS_PREFIX}${params.id}`) {
          await this.blights.updateById(blight.id, { status: "open" });
        }
      }

      // `folio_links.from_id` is not a foreign key, so nothing in the
      // database clears this quest's outbound links — see
      // `FolioLinkService.deleteLinksFrom`. Inbound rows are left alone on
      // purpose: a reference to a deleted quest is a broken link, which is
      // what the reader should see.
      await this.linkService.deleteLinksFrom({ kind: "quest", id: params.id });
      await this.quests.deleteById(params.id);
      // Logged from the row read at the top of the handler: once it is gone,
      // an id names nothing and the feed has no title to print.
      await this.logQuest("delete", quest, user);

      return { ok: true };
    },
  });

  startTimer = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = this.getQuestForTransition("start a timer on", [
        "accepted",
      ]);

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
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, user }) => {
      const { quest } = this.getQuestForTransition("stop a timer on", [
        "accepted",
      ]);

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
