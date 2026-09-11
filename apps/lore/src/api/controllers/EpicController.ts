import { $inject, z } from "alepha";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { type Epic, epics } from "../entities/epics.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import { epicManualStatusSchema } from "../schemas/epicManualStatusSchema.ts";
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
 * 403, and an epic a member could not mark ready or attach anything to would
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
 * it owns (`applyBacklogGate` / `draftEpicSqlPredicate`) governs the
 * PROJECT's listing surfaces (quest list, Kanban, Reports denominators) —
 * never an epic's own view of itself. See `computeProgressOf` below.
 */
export class EpicController {
  epics = $repository(epics);
  quests = $repository(quests);
  folios = $repository(folios);
  linkService = $inject(FolioLinkService);
  attachment = $inject(ReleaseAttachmentService);
  cascade = $inject(ReleaseCascadeService);
  dependencies = $inject(EpicDependencyService);
  /**
   * The epic phase gate: the quest set can change only while the epic is
   * `draft` or `ready`, and only those two statuses are set by hand. Every
   * refusal and its wording is written on the service, once, beside the two
   * automatic transitions the quest actions trigger.
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
   * the sidebar's draft-epic badge and the map the quests table's Epic
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
   * quest inside a draft epic is absent from the Quests badge by design,
   * and with no badge here at all that work had no representation in the
   * sidebar whatsoever. `draft` alone, because the quests of a ready or
   * in-progress epic are already counted next to Quests and badging them
   * would double-report them. The count is now derived client-side from this
   * list, the same way `ProjectEpics` already derives it.
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
         * The epic that has to come first. It gates the START: no quest of
         * this epic is accepted while the predecessor is not completed - see
         * the column's own comment. `null` is the same as omitting it.
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
        status: "draft",
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
         * Writable in every status: it gates the start, which is checked when
         * it happens. Cycles are refused, which is a different question; both
         * are settled on the column, in `epics.ts`.
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
   * The only status moves a person makes: `draft` to `ready`, and back.
   *
   * `ready` is the one decision left in the lifecycle ("the spec is done,
   * release it to the backlog"). The other two statuses are facts, written by
   * the quest requests that make them true: the first quest accepted or
   * assigned moves a ready epic to `in_progress`, and the request that
   * resolves the last open quest moves it to `completed`
   * (`EpicWorkflowService.startIfReady` / `completeIfResolved`). So the body
   * offers two values, and an agent reading the tool schema sees that it
   * cannot ask for the others.
   *
   * It replaced epic #31's Begin and Conclude clicks (#Q2223). Neither was a
   * decision in practice: the Work-on-it prompt told the agent to make both,
   * and on 2026-09-10 not one of project 1's 49 epics was `active`.
   *
   * Asking for the status the epic already has is a no-op that writes
   * nothing and logs nothing (`epic_set_status` is declared idempotent).
   *
   * ⚠️ **Status is never written to a quest row.** Marking an epic ready
   * releases its quests because the backlog gate (`EpicVisibilityService`)
   * stops matching them, not because anything about them changed, and moving
   * it back to `draft` hides them the same way. Nothing here touches a
   * quest, on either edge.
   */
  setEpicStatus = $action({
    use: [this.ownsEpicForWork("epic:write")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        status: epicManualStatusSchema,
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const epic = this.owned.get<Epic>();

      if (body.status === epic.status) {
        return await this.buildEpicResource(epic);
      }
      this.workflow.assertManualEdge(epic, body.status);

      const updated = await this.epics.updateById(params.id, {
        status: body.status,
      });

      await this.logEpic("status", updated, user, {
        from: epic.status,
        to: body.status,
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
        // that epic is draft or ready, and a MOVE has to satisfy both
        // ends: the quest cannot be pulled out of a frozen plan any more
        // than pushed into one. The target is checked first, since it is
        // what the caller asked for; the source only when there is one.
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
        // epic is draft or ready. Shelve is the route for one that will
        // not be done, and the message says so.
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
   * `EpicVisibilityService`. That gate hides a `draft` epic's quests
   * from the PROJECT's own listing surfaces; inside the epic's own view
   * every quest counts, draft-gated ones included. An epic reporting
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
   * `todo` status (see `quests.shelvedAt`), so it never coexists with
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
