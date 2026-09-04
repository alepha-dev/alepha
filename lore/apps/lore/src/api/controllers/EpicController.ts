import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, $transactional } from "alepha/orm";
import {
  OwnedResourceProvider,
  type UserAccountToken,
  $secure,
} from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { type Epic, epics } from "../entities/epics.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import { epicRefResourceSchema } from "../schemas/epicRefResourceSchema.ts";
import {
  type EpicResource,
  epicResourceSchema,
} from "../schemas/epicResourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { BoundParameters } from "../services/BoundParameters.ts";
import { EpicDependencyService } from "../services/EpicDependencyService.ts";
import { EpicWorkflowService } from "../services/EpicWorkflowService.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
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
  /**
   * The epic phase gate (epic #31): the quest set can change only while the
   * epic is `planned`, and the two status edges each have a precondition.
   * Every refusal and its wording is written on the service, once.
   */
  workflow = $inject(EpicWorkflowService);
  audits = $inject(LoreAudits);
  owned = $inject(OwnedResourceProvider);

  /**
   * One project-layer audit row for something that happened to an epic.
   *
   * `resourceId` is the epic's per-project **number**, which is what
   * `/:projectSlug/epics/:epicNumber` takes - the same reasoning as
   * `QuestController.logEpic`'s shortId. A row id would name a page that does
   * not exist.
   */
  protected async logEpic(
    action: string,
    epic: Pick<Epic, "number" | "title" | "projectId">,
    user: UserAccountToken | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.epic.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(epic.projectId),
      resourceType: "epic",
      resourceId: String(epic.number),
      description: epic.title,
      ...(metadata ? { metadata } : {}),
    });
  }
  bound = $inject(BoundParameters);

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
      const byId = new Map(allEpics.map((epic) => [epic.id, epic]));

      return allEpics.map((epic) =>
        this.toEpicResource(
          epic,
          progress.get(epic.id) ?? this.zeroProgress(),
          epic.dependsOn != null ? byId.get(epic.dependsOn) : undefined,
        ),
      );
    },
  });

  /**
   * Every epic in the project, reduced to the four fields another list needs
   * in order to NAME one. Feeds the project route, which turns it into both
   * the sidebar's planned-epic badge and the map the quests table's Epic
   * column resolves against.
   *
   * Deliberately not `getEpics`. `epicResourceSchema` is `epics.schema`
   * extended, so it carries `description` (`size: "rich"`): on this project's
   * own database that list is 28 rows and 222 KB of JSON, 213 KB of it
   * descriptions. Every project navigation would pay it, to render a column
   * that is `defaultHidden` and a badge that is one integer. This projection
   * is the same 28 rows in under 2 KB.
   *
   * One query, and no progress rollup: `computeProgressOf`'s two aggregates
   * are exactly what neither caller reads.
   *
   * ⚠️ The badge this replaces had its own `countPlannedEpics` action, and
   * its reasoning survives the swap: the badge counts the GATE rather than
   * the work behind it. `countOpenQuests` runs `applyBacklogGate`, so every
   * quest inside a planned epic is absent from the Quests badge by design,
   * and with no badge here at all that work had no representation in the
   * sidebar whatsoever. `planned` and not `active`, because an active epic's
   * quests are already counted next to Quests and badging them would
   * double-report them. The count is now derived client-side from this list,
   * the same way `ProjectEpics` already derives it.
   */
  getEpicRefs = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.array(epicRefResourceSchema),
    },
    handler: async ({ params }) => {
      return await this.epics.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        columns: ["id", "number", "title", "status"],
        orderBy: [{ column: "number", direction: "asc" }],
      });
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
    handler: async ({ params, body, user }) => {
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
      await this.logEpic("create", epic, user);

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
    handler: async ({ params, body, user }) => {
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
      await this.logEpic("update", updated, user, {
        fields: Object.keys(body),
      });

      return await this.buildEpicResource(updated);
    },
  });

  /**
   * A one-way ratchet: `planned` to `active`, `active` to `done`, and
   * nothing else. `done` is terminal, with no reopen and no return to
   * planning; the way forward from a concluded epic is a new epic that
   * depends on it.
   *
   * Nine legal transitions became two with epic #31, and this is what makes
   * the rest of that epic hold: every refusal the phase gate adds (a quest
   * can be worked only while its epic is active, the quest set is frozen
   * once it is) would be undone by flipping the epic back a phase. Until
   * then every edge was legal on purpose, and `activatedAt` carried a
   * paragraph about surviving `done`/`planned` swings; there are no swings,
   * so it is simply when the epic began, stamped on the one edge that
   * begins it. `completedAt` is stamped on the one edge that concludes it,
   * and is never cleared.
   *
   * The body schema still accepts the three values: the refusal is on the
   * EDGE, not the value, so asking for the status the epic already has is a
   * no-op that writes nothing and logs nothing (`epic_set_status` is declared
   * idempotent).
   *
   * ⚠️ Must not write to any quest row. Activating an epic releases its
   * quests because the backlog gate (`EpicVisibilityService`) stops
   * matching them, not because anything about them changed — this is the
   * single most important invariant in this controller, and a terminal
   * `done` is the transition most tempted to break it by "stamping" the
   * quests. See `EpicController.spec.ts`'s `updatedAt`-is-unchanged
   * assertion.
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
    handler: async ({ params, body, user }) => {
      const epic = this.owned.get<Epic>();

      if (body.status === epic.status) {
        return await this.buildEpicResource(epic);
      }
      this.assertStatusEdge(epic, body.status);
      // The gate on Begin (epic #31): an epic cannot begin while the epic it
      // depends on is not done. Evaluated here and only here; `dependsOn`
      // stays writable in every phase because the roadmap draws it.
      if (body.status === "active") {
        await this.workflow.assertCanBegin(epic);
      }

      const updated = await this.epics.updateById(params.id, {
        status: body.status,
        ...(body.status === "active"
          ? { activatedAt: this.dt.nowISOString() }
          : {}),
        ...(body.status === "done"
          ? { completedAt: this.dt.nowISOString() }
          : {}),
      });
      await this.logEpic("status", updated, user, {
        from: epic.status,
        to: body.status,
      });

      return await this.buildEpicResource(updated);
    },
  });

  /**
   * The two edges of the ratchet, and the words for the three refused ones.
   *
   * Written here rather than on `EpicWorkflowService` because this is the
   * one place a status is ever written, so there is nothing to keep in step
   * with; the service holds the questions the two legal edges consult
   * (`assertCanBegin`, `assertCanConclude`), which several callers ask.
   * Same rule as every message on the service: name the epic by its number,
   * and name the way forward.
   */
  protected assertStatusEdge(
    epic: Pick<Epic, "number" | "status">,
    to: Epic["status"],
  ): void {
    if (epic.status === "planned" && to === "active") return;
    if (epic.status === "active" && to === "done") return;

    const move = `Cannot move Epic #${epic.number} from ${epic.status} to ${to}.`;
    if (epic.status === "done") {
      throw new BadRequestError(
        `${move} An epic is concluded once. Create a new epic that depends on it.`,
      );
    }
    if (epic.status === "active") {
      throw new BadRequestError(
        `${move} Its plan is frozen. Shelve what will not be done, or create a new epic.`,
      );
    }
    throw new BadRequestError(`${move} Begin it first.`);
  }

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
    handler: async ({ params, user }) => {
      const epic = this.owned.get<Epic>();

      // `folio_links.from_id` is not a foreign key, so the FK cascade this
      // delete relies on for quests and folios does not reach the link
      // graph — see `FolioLinkService.deleteLinksFrom`.
      await this.linkService.deleteLinksFrom({ kind: "epic", id: params.id });
      await this.epics.deleteById(params.id, { force: true });
      await this.logEpic("delete", epic, user);

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
    handler: async ({ body, user }) => {
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
        // The plan freeze (epic #31). A quest enters an epic only while
        // that epic is planned, and a MOVE has to satisfy both ends: the
        // quest cannot be pulled out of a frozen plan any more than pushed
        // into one. The target is checked first, since it is what the
        // caller asked for; the source only when there is one.
        this.workflow.assertPlanEditable(epic, { kind: "add" });
        if (quest.epicId != null) {
          const source = await this.epics.findOne({
            where: { id: { eq: quest.epicId } },
          });
          if (source) {
            this.workflow.assertPlanEditable(source, {
              kind: "remove",
              quest,
            });
          }
        }

        await this.quests.updateById(quest.id, { epicId: epic.id });
        await this.logEpic("attach", epic, user, {
          quest: quest.shortId,
        });
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
    handler: async ({ params, user }) => {
      const epic = this.owned.get<Epic>();

      const quest = await this.quests.getById(params.questId);
      if (quest.epicId === epic.id) {
        // The plan freeze (epic #31): a quest leaves an epic only while the
        // epic is planned. Shelve is the route for one that will not be
        // done, and the message says so.
        this.workflow.assertPlanEditable(epic, { kind: "remove", quest });

        await this.quests.updateById(quest.id, { epicId: null });
        await this.logEpic("detach", epic, user, { quest: quest.shortId });
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
    handler: async ({ body, user }) => {
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
        await this.logEpic("attach", epic, user, { folio: folio.shortId });
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
    handler: async ({ params, user }) => {
      const epic = this.owned.get<Epic>();

      const folio = await this.folios.getById(params.folioId);
      if (folio.epicId === epic.id) {
        await this.folios.updateById(folio.id, { epicId: null });
        await this.logEpic("detach", epic, user, { folio: folio.shortId });
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
      predecessor,
    );
  }

  /**
   * Assembles the resource once the rollup is in hand, so the single-epic
   * path and the batched list path cannot drift on what a resource is.
   *
   * ⚠️ The predecessor is supplied rather than looked up, for the same
   * reason `progress` is: this method is the one place a resource is built,
   * and the two callers reach both facts differently - one row at a time, or
   * batched over the whole list. A lookup in here would make the batched path
   * N+1 again, and computing it in only one caller would let `epic_list`
   * silently stop carrying a field `epic_get` returns. Its `number` and its
   * `status` ride out together, so neither surface can carry one without the
   * other.
   */
  protected toEpicResource(
    epic: Epic,
    progress: EpicProgress,
    predecessor?: Pick<Epic, "number" | "status">,
  ): EpicResource {
    return {
      ...epic,
      progress,
      questCount: progress.total,
      dependsOnNumber: predecessor?.number,
      dependsOnStatus: predecessor?.status,
    };
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

    // Chunked: one bound parameter per epic, and nothing caps how many epics
    // a project has.
    const buckets = await this.bound.collect(epicIds, (batch) =>
      this.quests.aggregate({
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
        where: { epicId: { inArray: batch } },
        groupBy: ["epicId"],
      }),
    );

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
