import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { OwnedResourceProvider, $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { type Epic, epics } from "../entities/epics.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import {
  type EpicResource,
  epicResourceSchema,
} from "../schemas/epicResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { EpicDependencyService } from "../services/EpicDependencyService.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { ReleaseAttachmentService } from "../services/ReleaseAttachmentService.ts";

/**
 * CRUD, the status lifecycle, and attach/detach for quests and folios.
 *
 * Same `$secure` permission strings as `ReleaseController`
 * (`quest:read` to read, `quest:create` to mutate, `quest:delete` on
 * `deleteEpic` — matching `ReleaseController.deleteRelease` and
 * `QuestController.deleteQuest`, both of which gate delete on its own
 * permission rather than `quest:create`), and `$transactional()` on create.
 *
 * **Every endpoint here is member-gated, read and write alike** - the
 * `QuestController` / `FolioController` rule, not the
 * `ReleaseController` one it was originally modelled on. An epic groups
 * quests and folios, both of which any member may already create, rename
 * and delete; gating the grouping on ownership meant the header's "Create
 * epic" entry (shown to every member, `ProjectActionsCreateButton`) answered
 * 403, and an epic a member could not activate or attach anything to would
 * be inert anyway. `deleteEpic` follows `QuestController.deleteQuest`, which
 * is member-gated for the same reason.
 *
 * Project *configuration* stays owner-only — that split lives in
 * `ProjectController` and `ReleaseController`, not here.
 *
 * **This class is now the sole `$repository(epics)` holder.** It replaces
 * `EpicTableRegistration`, the temporary scaffolding Task 1 left behind
 * purely to keep `epics` in the migration snapshot before a real consumer
 * existed.
 *
 * Deliberately does NOT inject `EpicVisibilityService`. The backlog gate
 * it owns (`applyBacklogGate` / `plannedEpicSqlPredicate`) governs the
 * PROJECT's listing surfaces (quest list, Kanban, Reports denominators) —
 * never an epic's own view of itself. See `computeProgress` below.
 */
export class EpicController {
  epics = $repository(epics);
  quests = $repository(quests);
  folios = $repository(folios);
  dt = $inject(DateTimeProvider);
  linkService = $inject(FolioLinkService);
  attachment = $inject(ReleaseAttachmentService);
  dependencies = $inject(EpicDependencyService);
  owned = $inject(OwnedResourceProvider);

  /**
   * Member gate on the project the route names directly.
   *
   * Declared above the actions on purpose: `use: [this.ownsProject()]` is a
   * field initializer reading another field, so a gate declared below the
   * first action that uses it is `undefined` at construction time.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  /**
   * Member gate on the project the epic named by `params.id` belongs to.
   *
   * The epic itself lands on `this.owned.get<Epic>()`, so a handler that
   * needs the row reads it back rather than issuing the same `getById` the
   * gate just did.
   */
  protected ownsEpic = () =>
    $ownsProject({ repository: () => this.epics, param: "id" });

  /**
   * Per-project sequence for `epics.number`. `$sequence` keys its counter
   * on the PROPERTY NAME — renaming this property restarts every
   * project's counter at 1. A rename needs an `UPDATE alepha_sequences
   * SET name` in the migration, exactly as `chapterNumber` →
   * `releaseNumber` did.
   */
  protected epicNumber = $sequence();

  getEpics = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.array(epicResourceSchema),
    },
    handler: async ({ params }) => {
      const allEpics = await this.epics.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "asc" }],
      });

      // Two aggregates for the whole page rather than four counts per row.
      // The list used to fan `computeProgress` out over every epic, which is
      // where `GET /api/getEpics/1` got its 89 D1 round trips.
      const progress = await this.computeProgressOf(
        allEpics.map((epic) => epic.id),
      );

      // The `dependsOn` translation, batched for the same reason: one query
      // for the list rather than one per epic that has a predecessor. Every
      // predecessor is in `allEpics` already (a dependency cannot leave its
      // project), so this reads off the rows in hand.
      const numbers = new Map(allEpics.map((epic) => [epic.id, epic.number]));

      return allEpics.map((epic) =>
        this.toEpicResource(
          epic,
          progress.get(epic.id) ?? this.zeroProgress(),
          epic.dependsOn != null ? numbers.get(epic.dependsOn) : undefined,
        ),
      );
    },
  });

  /**
   * How many epics are still `planned`, for the sidebar's Epics badge.
   *
   * Counts the gate itself rather than the work behind it. `countOpenQuests`
   * runs `applyBacklogGate`, so every quest inside a planned epic is absent
   * from the Quests badge by design; with no badge here at all, that work had
   * no representation in the sidebar whatsoever. This number is what says it
   * exists.
   *
   * `planned` and not `active`: an active epic's quests are already counted
   * next to Quests, so badging those would double-report them.
   *
   * Covered by `epics_project_id_status_idx` on `(project_id, status)`.
   */
  countPlannedEpics = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ params }) => {
      const count = await this.epics.count({
        projectId: { eq: params.projectId },
        status: { eq: "planned" },
      });

      return { count };
    },
  });

  getEpicByNumber = $action({
    // Gated on the PARAM, not on the epic it finds: a foreign project is
    // refused before the epics table is touched, and there is nothing to hop
    // from anyway since the lookup is by (project, number) rather than by id.
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    path: "/projects/:projectId/epics/:number",
    schema: {
      params: z.object({
        projectId: z.integer(),
        number: z.integer(),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params }) => {
      const epic = await this.epics.getOne({
        where: {
          projectId: { eq: params.projectId },
          number: { eq: params.number },
        },
      });

      return await this.buildEpicResource(epic);
    },
  });

  createEpic = $action({
    // Gate INSIDE the transaction, not ahead of it - see `$ownsProject`.
    use: [
      $secure({ permissions: ["quest:create"] }),
      $transactional(),
      this.ownsProject(),
    ],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        title: z.string().min(3).max(80),
        description: z.string().meta({ size: "rich" }).optional(),
        /**
         * The epic that has to come first. Advisory: nothing is refused
         * because of it - see the column's own comment for why. `null` is
         * the same as omitting it.
         */
        dependsOn: z.integer().nullable().optional(),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body }) => {
      // No `epicId` yet, so neither a self-reference nor a cycle is possible
      // and only the "same project" half of the check can run.
      const dependsOn = await this.dependencies.resolve(
        params.projectId,
        undefined,
        body.dependsOn ?? null,
      );

      const number = await this.epicNumber.next(String(params.projectId));
      const epic = await this.epics.create({
        projectId: params.projectId,
        number,
        title: body.title,
        description: body.description ?? "",
        status: "planned",
        ...(dependsOn !== null ? { dependsOn } : {}),
      });
      await this.syncEpicLinks(epic);

      return await this.buildEpicResource(epic);
    },
  });

  updateEpic = $action({
    use: [$secure({ permissions: ["quest:create"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        title: z.string().min(3).max(80).optional(),
        description: z.string().meta({ size: "rich" }).optional(),
        /**
         * The release this epic ships in. `null` detaches it.
         *
         * A field on the one write path rather than a separate
         * attach/detach pair: one write path is easier to keep honest than
         * two, and both directions need the same refusal anyway.
         */
        releaseId: z.integer().nullable().optional(),
        /**
         * The epic that has to come first. `null` clears it.
         *
         * Advisory - no status transition is refused because of it. Cycles
         * are refused, which is a different question; both are settled on the
         * column, in `epics.ts`.
         */
        dependsOn: z.integer().nullable().optional(),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body }) => {
      const epic = this.owned.get<Epic>();

      const releaseId =
        body.releaseId !== undefined
          ? await this.attachment.resolve(
              epic.projectId,
              epic.releaseId,
              body.releaseId,
            )
          : undefined;

      const dependsOn =
        body.dependsOn !== undefined
          ? await this.dependencies.resolve(
              epic.projectId,
              epic.id,
              body.dependsOn,
            )
          : undefined;

      const updated = await this.epics.updateById(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(releaseId !== undefined ? { releaseId } : {}),
        // `null` rather than `undefined` so the column is actually cleared -
        // an undefined patch value reads as "leave unchanged".
        ...(dependsOn !== undefined ? { dependsOn } : {}),
      });
      await this.syncEpicLinks(updated);

      return await this.buildEpicResource(updated);
    },
  });

  /**
   * `planned | active | done`, all four transitions legal — there is no
   * forbidden edge. Stamps `activatedAt` on the FIRST move to `active`
   * (kept across later `done`/`planned` swings — it marks when the epic
   * began, not when it was last active) and `completedAt` on `done`,
   * clearing `completedAt` on any move away from `done`.
   *
   * ⚠️ Must not write to any quest row. Activating an epic releases its
   * quests because the backlog gate (`EpicVisibilityService`) stops
   * matching them, not because anything about them changed — this is the
   * single most important invariant in this controller. See
   * `EpicController.spec.ts`'s `updatedAt`-is-unchanged assertion.
   */
  setEpicStatus = $action({
    use: [$secure({ permissions: ["quest:create"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        status: z.enum(["planned", "active", "done"]),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body }) => {
      const epic = this.owned.get<Epic>();

      const updated = await this.epics.updateById(params.id, {
        status: body.status,
        ...(body.status === "active" && !epic.activatedAt
          ? { activatedAt: this.dt.nowISOString() }
          : {}),
        ...(body.status === "done"
          ? { completedAt: this.dt.nowISOString() }
          : {}),
        ...(body.status !== "done" && epic.completedAt
          ? { completedAt: null }
          : {}),
      });

      return await this.buildEpicResource(updated);
    },
  });

  /**
   * Relies on the `epicId` FK's `ON DELETE SET NULL` to orphan the epic's
   * quests and folios. `epics` carries `deletedAt` (soft delete), so a
   * plain `deleteById` would only UPDATE the row and never reach the
   * physical DELETE that fires the FK action — `force: true` is what
   * makes this a real delete. Must never iterate quests/folios to clear
   * them by hand.
   */
  deleteEpic = $action({
    use: [$secure({ permissions: ["quest:delete"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      // `folio_links.from_id` is not a foreign key, so the FK cascade this
      // delete relies on for quests and folios does not reach the link
      // graph — see `FolioLinkService.deleteLinksFrom`.
      await this.linkService.deleteLinksFrom({ kind: "epic", id: params.id });
      await this.epics.deleteById(params.id, { force: true });

      return { ok: true };
    },
  });

  attachQuest = $action({
    use: [$secure({ permissions: ["quest:create"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ questId: z.integer() }),
      response: epicResourceSchema,
    },
    handler: async ({ body }) => {
      const epic = this.owned.get<Epic>();

      // Coherence, not access: `$ownsProject` gated the EPIC, and says
      // nothing about the quest being attached to it.
      const quest = await this.quests.getById(body.questId);
      if (quest.projectId !== epic.projectId) {
        throw new BadRequestError(
          "Quest belongs to a different project than this epic",
        );
      }

      if (quest.epicId !== epic.id) {
        await this.quests.updateById(quest.id, { epicId: epic.id });
      }

      return await this.buildEpicResource(epic);
    },
  });

  detachQuest = $action({
    use: [$secure({ permissions: ["quest:create"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer(), questId: z.integer() }),
      response: epicResourceSchema,
    },
    handler: async ({ params }) => {
      const epic = this.owned.get<Epic>();

      const quest = await this.quests.getById(params.questId);
      if (quest.epicId === epic.id) {
        await this.quests.updateById(quest.id, { epicId: null });
      }

      return await this.buildEpicResource(epic);
    },
  });

  attachFolio = $action({
    use: [$secure({ permissions: ["quest:create"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ folioId: z.uuid() }),
      response: epicResourceSchema,
    },
    handler: async ({ body }) => {
      const epic = this.owned.get<Epic>();

      // Coherence, not access - see `attachQuest`.
      const folio = await this.folios.getById(body.folioId);
      if (folio.projectId !== epic.projectId) {
        throw new BadRequestError(
          "Folio belongs to a different project than this epic",
        );
      }

      if (folio.epicId !== epic.id) {
        await this.folios.updateById(folio.id, { epicId: epic.id });
      }

      return await this.buildEpicResource(epic);
    },
  });

  detachFolio = $action({
    use: [$secure({ permissions: ["quest:create"] }), this.ownsEpic()],
    schema: {
      params: z.object({ id: z.integer(), folioId: z.uuid() }),
      response: epicResourceSchema,
    },
    handler: async ({ params }) => {
      const epic = this.owned.get<Epic>();

      const folio = await this.folios.getById(params.folioId);
      if (folio.epicId === epic.id) {
        await this.folios.updateById(folio.id, { epicId: null });
      }

      return await this.buildEpicResource(epic);
    },
  });

  /**
   * Re-sync this epic's outbound `[[...]]` links.
   *
   * An epic has one markdown field, so unlike the quest equivalent there
   * is nothing to concatenate — but it is a named method for the same
   * reason: the discriminator and the id shape are decided in one place
   * rather than at each call site.
   */
  protected async syncEpicLinks(epic: Epic): Promise<void> {
    await this.linkService.syncLinks(
      { kind: "epic", id: epic.id, projectId: epic.projectId },
      epic.description ?? "",
    );
  }

  /**
   * Attaches the server-computed rollup to an epic row. Counts EVERY
   * quest belonging to the epic — deliberately NOT gated through
   * `EpicVisibilityService`. That gate hides a `planned` epic's quests
   * from the PROJECT's own listing surfaces; inside the epic's own view
   * every quest counts, planned-gated ones included. An epic reporting
   * 0/13 is telling the truth, one reporting 0/0 because its own quests
   * are hidden from it is not (design §5.3).
   */
  protected async buildEpicResource(epic: Epic): Promise<EpicResource> {
    // One extra read, and only for an epic that HAS a predecessor. Cheap next
    // to the rollup beside it, and it is what stops every consumer holding
    // the epic list purely to turn an id into a `#7`. `getEpics` resolves the
    // same thing off the rows it already holds, with no query at all.
    const predecessor =
      epic.dependsOn != null
        ? await this.epics.findOne({ where: { id: { eq: epic.dependsOn } } })
        : undefined;

    return this.toEpicResource(
      epic,
      await this.computeProgress(epic),
      predecessor?.number,
    );
  }

  /**
   * Assembles the resource once the rollup is in hand, so the single-epic
   * path and the batched list path cannot drift on what a resource is.
   *
   * ⚠️ `dependsOnNumber` is supplied rather than looked up, for the same
   * reason `progress` is: this method is the one place a resource is built,
   * and the two callers reach both facts differently - one row at a time, or
   * batched over the whole list. A lookup in here would make the batched path
   * N+1 again, and computing it in only one caller would let `epic_list`
   * silently stop carrying a field `epic_get` returns.
   */
  protected toEpicResource(
    epic: Epic,
    progress: EpicProgress,
    dependsOnNumber?: number,
  ): EpicResource {
    return { ...epic, progress, questCount: progress.total, dependsOnNumber };
  }


  /**
   * What an epic with no quests reports. `aggregate()` returns no row at
   * all for an empty group, so the caller supplies the zeros rather than
   * reading them back.
   */
  protected zeroProgress(): EpicProgress {
    return { completed: 0, inProgress: 0, shelved: 0, total: 0 };
  }

  /**
   * The four buckets are disjoint by construction, so the list row can
   * derive the untouched remainder as
   * `total - completed - inProgress - shelved` without a fifth count:
   * `shelvedAt` is only ever set on a quest still in `new` status (see
   * `quests.shelvedAt`), so it never coexists with `acceptedAt` or
   * `completedAt`, and `inProgress` explicitly excludes both of the
   * others.
   */
  protected async computeProgress(epic: Epic): Promise<EpicProgress> {
    const [total, completed, inProgress, shelved] = await Promise.all([
      this.quests.count({ epicId: { eq: epic.id } }),
      this.quests.count({
        epicId: { eq: epic.id },
        completedAt: { isNotNull: true },
      }),
      this.quests.count({
        epicId: { eq: epic.id },
        acceptedAt: { isNotNull: true },
        completedAt: { isNull: true },
      }),
      this.quests.count({
        epicId: { eq: epic.id },
        shelvedAt: { isNotNull: true },
      }),
    ]);

    return { completed, inProgress, shelved, total };
  }

  /**
   * `computeProgress` for a whole page of epics, in ONE query whatever the
   * page holds — the batched sibling, not a replacement. The single-epic
   * callers (`getEpicByNumber`, the create/update/status hops) keep
   * `computeProgress`, where four counts is already the right shape.
   *
   * Three of the four buckets are a plain `count` on a nullable column,
   * which compiles to `COUNT(col)` and so skips NULLs: counting
   * `completedAt` counts the quests that have one. The fourth is a
   * conjunction — accepted AND NOT completed — which no single column count
   * expresses, so it is a conditioned aggregate: `count` over `id` with its
   * own `where`, which compiles to `COUNT(CASE WHEN ... THEN id END)`.
   *
   * ⚠️ Not `COUNT(accepted_at) - COUNT(completed_at)`, which would also be
   * one pass but only if "completed implies accepted" held. Nothing in
   * `quests` states that, so the derivation would be silently wrong the
   * first time a quest is completed without being accepted.
   *
   * ⚠️ The conditioned bucket counts `id` and not `acceptedAt`, because
   * `COUNT(CASE WHEN c THEN col END)` skips NULLs of `col` as well as rows
   * failing `c` — and the primary key is the column that is never null.
   *
   * `aggregate()` applies `withOrganization` / `withDeletedAt` exactly like
   * `count()`, and the per-aggregate `where` narrows inside the CASE rather
   * than replacing that clause, so the tenancy and soft-delete filtering is
   * unchanged.
   */
  protected async computeProgressOf(
    epicIds: number[],
  ): Promise<Map<number, EpicProgress>> {
    const progress = new Map<number, EpicProgress>();
    // `inArray: []` throws, so a project with no epics never reaches the
    // query. An empty map is the right answer for it anyway.
    if (epicIds.length === 0) {
      return progress;
    }

    const buckets = await this.quests.aggregate({
      select: {
        epicId: true,
        id: { count: true },
        completedAt: { count: true },
        shelvedAt: { count: true },
        inProgress: {
          count: {
            column: "id",
            where: {
              acceptedAt: { isNotNull: true },
              completedAt: { isNull: true },
            },
          },
        },
      },
      where: { epicId: { inArray: epicIds } },
      groupBy: ["epicId"],
    });

    for (const row of buckets) {
      if (row.epicId == null) continue;
      progress.set(row.epicId, {
        completed: row.completedAt.count,
        inProgress: row.inProgress.count,
        shelved: row.shelvedAt.count,
        total: row.id.count,
      });
    }

    return progress;
  }
}

/**
 * The rollup `epicResourceSchema.progress` carries, named once so the
 * per-epic and batched paths cannot disagree on its shape.
 */
type EpicProgress = EpicResource["progress"];
