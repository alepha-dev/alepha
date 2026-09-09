import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { type Epic, epics } from "../entities/epics.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import { epicRefResourceSchema } from "../schemas/epicRefResourceSchema.ts";
import {
  type EpicResource,
  epicResourceSchema,
} from "../schemas/epicResourceSchema.ts";
import {
  type ReleaseCascade,
  releaseCascadeSchema,
} from "../schemas/releaseCascadeSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { BoundParameters } from "../services/BoundParameters.ts";
import { DefaultReleaseService } from "../services/DefaultReleaseService.ts";
import { EpicDependencyService } from "../services/EpicDependencyService.ts";
import {
  type EpicProgress,
  EpicProgressService,
} from "../services/EpicProgressService.ts";
import { EpicWorkflowService } from "../services/EpicWorkflowService.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ReleaseAttachmentService } from "../services/ReleaseAttachmentService.ts";
import { ReleaseCascadeService } from "../services/ReleaseCascadeService.ts";

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
 * never an epic's own view of itself. See `computeProgressOf` below.
 */
export class EpicController {
  epics = $repository(epics);
  quests = $repository(quests);
  folios = $repository(folios);
  dt = $inject(DateTimeProvider);
  linkService = $inject(FolioLinkService);
  attachment = $inject(ReleaseAttachmentService);
  cascade = $inject(ReleaseCascadeService);
  /**
   * Where an epic ships when nobody said (#E48). Read on the Begin edge only,
   * and best effort: beginning an epic must never fail over a planning
   * convenience.
   */
  defaults = $inject(DefaultReleaseService);
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
  epicProgress = $inject(EpicProgressService);

  /**
   * Member gate on the project the route names directly.
   *
   * Declared above the actions on purpose: `use: [this.ownsProject()]` is a
   * field initializer reading another field, so a gate declared below the
   * first action that uses it is `undefined` at construction time.
   */
  protected ownsProject = (requires: string | string[]) =>
    $ownsProject({ requires, param: "projectId" });

  /**
   * Member gate on the project the epic named by `params.id` belongs to.
   *
   * The epic itself lands on `this.owned.get<Epic>()`, so a handler that
   * needs the row reads it back rather than issuing the same `getById` the
   * gate just did.
   */
  protected ownsEpic = (requires: string | string[]) =>
    $ownsProject({ requires, repository: () => this.epics, param: "id" });

  /**
   * The same two gates plus the Work capability, for the writes.
   *
   * Gated on the capability rather than on `work.epics`, deliberately: the
   * option decides what the sidebar OFFERS, and a saved link keeps resolving
   * either way - the rule `projectKanban` set. Reads stay open, because
   * disabling hides and never deletes.
   */
  protected ownsProjectForWork = (requires: string | string[]) =>
    $ownsProject({ requires, param: "projectId", capability: "work" });

  protected ownsEpicForWork = (requires: string | string[]) =>
    $ownsProject({
      requires,
      repository: () => this.epics,
      param: "id",
      capability: "work",
    });

  /**
   * Per-project sequence for `epics.number`. `$sequence` keys its counter
   * on the PROPERTY NAME — renaming this property restarts every
   * project's counter at 1. A rename needs an `UPDATE alepha_sequences
   * SET name` in the migration, exactly as `chapterNumber` →
   * `releaseNumber` did.
   */
  protected epicNumber = $sequence();

  getEpics = $action({
    use: [this.ownsProject("epic:read")],
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
      // The list used to fan a per-epic rollup out over every epic, which is
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
    use: [this.ownsProject("epic:read")],
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
    use: [this.ownsProject("epic:read")],
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
    use: [$transactional(), this.ownsProjectForWork("epic:write")],
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
      // A brand-new id has no links to clear, so the delete is skipped.
      await this.syncEpicLinks(epic, { created: true });
      await this.logEpic("create", epic, user);

      return await this.buildEpicResource(epic);
    },
  });

  updateEpic = $action({
    use: [this.ownsEpicForWork("epic:write")],
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
         * two, and both directions need the same refusal anyway. That one
         * path is also what makes the cascade below reach every caller -
         * the epic page, both tables' row menus, and `release_attach` /
         * `release_detach` over MCP all arrive here.
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
      /**
       * The epic, plus what its release did to the epic's quests.
       *
       * `releaseCascade` is present only when a cascade ran, so a rename
       * answers exactly what it answered before. It is on this action's
       * response rather than on `epicResourceSchema` because it describes
       * one call, not the epic: a later `epic_get` has nothing to say about
       * a move that already happened.
       */
      response: epicResourceSchema.extend({
        releaseCascade: releaseCascadeSchema.optional(),
      }),
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
      // The epic's release is its quests' release (#Q2111). Only when it
      // actually moved: a cascade that ran on every update would read the
      // epic's whole quest set to rename it.
      //
      // AFTER the epic's own write, so a refusal on the epic itself never
      // leaves quests pointing at a release the epic is not in. The other
      // order cannot be fixed by catching, because there is no transaction
      // here to roll back.
      const cascade =
        releaseId !== undefined && releaseId !== (epic.releaseId ?? null)
          ? await this.cascade.toQuests(
              updated,
              // The epic's release BEFORE this write, read off the row the
              // gate loaded: it is what tells a quest that was following
              // this epic apart from one that named a release of its own.
              epic.releaseId ?? null,
              releaseId,
            )
          : undefined;

      await this.syncEpicLinks(updated);
      await this.logEpic("update", updated, user, {
        fields: Object.keys(body),
        ...(cascade ? { cascade } : {}),
      });

      return {
        ...(await this.buildEpicResource(updated)),
        ...(cascade ? { releaseCascade: cascade } : {}),
      };
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
   * ⚠️ **Status is never written to a quest row, and that invariant is
   * unchanged.** Activating an epic releases its quests because the backlog
   * gate (`EpicVisibilityService`) stops matching them, not because anything
   * about them changed - this is the single most important rule in this
   * controller, and a terminal `done` is the transition most tempted to break
   * it by "stamping" the quests. Nothing here touches `status`, `acceptedAt`,
   * `shelvedAt` or the kanban column, on any edge.
   *
   * ⚠️ **One narrow carve-out, added by #E48 and deliberate.** An epic that
   * names no release takes the project's DEFAULT release when it begins, and
   * `ReleaseCascadeService` then writes that one column, `releaseId`, onto
   * every quest of it that named none. That is the same cascade `updateEpic`
   * already runs, on an edge that is a release move like any other; the
   * alternative was an epic whose release disagrees with its own contents
   * forever, which is the 0/0 card the "why Begin" note below describes. Do
   * not delete the cascade to restore a rule whose point is the paragraph
   * above: the rule is about a quest's STATUS, and this writes a release.
   *
   * `EpicController.spec.ts` pins both halves - a Begin with no default
   * touches no quest row at all, and a Begin with one moves exactly the
   * release-less quests.
   */
  setEpicStatus = $action({
    use: [this.ownsEpicForWork("epic:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        status: z.enum(["planned", "active", "done"]),
      }),
      /**
       * The epic, plus what a Begin-attached release did to its quests.
       *
       * `releaseCascade` is present only when the default fired, so every
       * other transition answers exactly what it answered before. Same shape
       * `updateEpic` returns: an epic that silently acquires a release and
       * moves nine quest rows is a bigger surprise than the one
       * `quest_complete` reports.
       */
      response: epicResourceSchema.extend({
        releaseCascade: releaseCascadeSchema.optional(),
      }),
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
      // The gate on Conclude (epic #31): every quest completed or shelved,
      // or a terminal `done` strands the open one forever. Shelving is the
      // epic-level equivalent of waiving an objective on `completeQuest`.
      if (body.status === "done") {
        await this.workflow.assertCanConclude(epic);
      }

      // ⚠️ Begin, and never Conclude. Attaching on Conclude produces an epic
      // card that reads 0/0: its quests complete one at a time while the epic
      // still names no release, each is stamped individually by
      // `QuestController.attachToDefaultRelease` with whatever was default at
      // the time, and the epic then concludes into a release holding none of
      // its own work. Attaching on Begin inverts it - the epic names a
      // release from the moment work can start, the cascade below writes it
      // onto every quest that named none, and the completion rule then finds
      // an explicit release on each and leaves it alone.
      //
      // Best effort: `openDefault` answers `undefined` for a project with no
      // default, for one whose default has been published, and for a read
      // that failed. Beginning an epic must never fail over this.
      const releaseId =
        body.status === "active" && epic.releaseId == null
          ? (await this.defaults.openDefault(epic.projectId))?.id
          : undefined;

      const updated = await this.epics.updateById(params.id, {
        status: body.status,
        ...(body.status === "active"
          ? { activatedAt: this.dt.nowISOString() }
          : {}),
        ...(body.status === "done"
          ? { completedAt: this.dt.nowISOString() }
          : {}),
        ...(releaseId != null ? { releaseId } : {}),
      });

      // AFTER the epic's own write, for the reason `updateEpic` gives: there
      // is no transaction here, so the other order can leave quests pointing
      // at a release the epic is not in, and catching cannot undo it.
      //
      // ⚠️ `previous` is `null`, and that is load-bearing. The epic named no
      // release, so the follower test (`current === null || current ===
      // previous`) selects exactly the quests that name nothing. A quest
      // given an explicit release while the epic was being planned is counted
      // in `kept` and keeps its own - the deliberate cross-release state
      // `release-contents.spec.ts` pins, which the cascade must not eat here
      // any more than anywhere else.
      const cascade =
        releaseId != null
          ? await this.cascade.toQuests(updated, null, releaseId)
          : undefined;

      await this.logEpic("status", updated, user, {
        from: epic.status,
        to: body.status,
        ...(cascade ? { cascade } : {}),
      });

      return {
        ...(await this.buildEpicResource(updated)),
        ...(cascade ? { releaseCascade: cascade } : {}),
      };
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

    const move = `Cannot move Epic ${formatReference("epic", epic.number)} from ${epic.status} to ${to}.`;
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
    use: [this.ownsEpicForWork("epic:write")],
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

  /**
   * File a quest into this epic.
   *
   * ⚠️ **The single choke point for a quest ENTERING an epic**, which is why
   * the release inheritance below is here and not in three places: the epic
   * page's picker, `quest_create` with `epic_number` and `quest_update` with
   * `epic_number` all arrive at this action. `QuestController` has no
   * `epicId` field on either of its write paths.
   */
  attachQuest = $action({
    use: [this.ownsEpicForWork("epic:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ questId: z.integer() }),
      /**
       * Present only when the quest inherited the epic's release, and shaped
       * like `updateEpic`'s so one reader serves both.
       */
      response: epicResourceSchema.extend({
        releaseCascade: releaseCascadeSchema.optional(),
      }),
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

      let cascade: ReleaseCascade | undefined;
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

        // A quest joining an epic that already has a release inherits it
        // (#Q2111). Without this the drift returns the first time somebody
        // adds an eleventh quest, which is how the incident that produced
        // this rule happened in the first place.
        cascade = await this.cascade.toQuest(epic, quest);

        await this.logEpic("attach", epic, user, {
          quest: quest.shortId,
          ...(cascade ? { cascade } : {}),
        });
      }

      return {
        ...(await this.buildEpicResource(epic)),
        ...(cascade ? { releaseCascade: cascade } : {}),
      };
    },
  });

  detachQuest = $action({
    use: [this.ownsEpicForWork("epic:write")],
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
    use: [this.ownsEpicForWork("epic:write")],
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
    use: [this.ownsEpicForWork("epic:write")],
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
  protected async syncEpicLinks(
    epic: Epic,
    opts: { created?: boolean } = {},
  ): Promise<void> {
    await this.linkService.syncLinks(
      { kind: "epic", id: epic.id, projectId: epic.projectId },
      epic.description ?? "",
      opts,
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

    // ⚠️ `computeProgressOf`, not `computeProgress`: one grouped aggregate
    // rather than four counts. The batched sibling was written for `getEpics`
    // after the 89-round-trip incident and this path simply never switched,
    // so every create, update and status hop paid four statements for a
    // rollup that costs one (#Q2146). `zeroProgress()` covers the epic with
    // no quests, for which `aggregate()` returns no row at all.
    const progress = await this.computeProgressOf([epic.id]);

    return this.toEpicResource(
      epic,
      progress.get(epic.id) ?? this.zeroProgress(),
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
   * The rollup for any set of epics, in ONE query whatever the set holds.
   *
   * ⚠️ **The only way to compute it.** There used to be a four-count sibling
   * for the single-epic path, on the reasoning that four counts is the right
   * shape for one epic; it was written before this one and simply never
   * retired. Four statements is not the right shape for anything when one
   * answers the same question, and having two spellings is how `epic_list`
   * and `epic_get` come to disagree about a rollup. Deleted with #Q2146.
   *
   * The four buckets are disjoint by construction, so a caller can derive
   * the untouched remainder as `total - completed - inProgress - shelved`
   * without a fifth count: `shelvedAt` is only ever set on a quest still in
   * `new` status (see `quests.shelvedAt`), so it never coexists with
   * `acceptedAt` or `completedAt`, and `inProgress` explicitly excludes both
   * of the others.
   *
   * ⚠️ The implementation moved to `EpicProgressService` when the dashboard's
   * epic card became a fifth reader of it (#Q2106). This delegates rather
   * than reimplementing, for the reason that service's own doc gives: the
   * Epics list, `epic_list`, `project_context`, MCP output and the card must
   * never disagree by one, and a second copy is how they would.
   */
  protected async computeProgressOf(
    epicIds: number[],
  ): Promise<Map<number, EpicProgress>> {
    return this.epicProgress.computeProgressOf(epicIds);
  }
}
