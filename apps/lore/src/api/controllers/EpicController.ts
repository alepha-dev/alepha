import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { type Epic, epics } from "../entities/epics.ts";
import { folios } from "../entities/folios.ts";
import { quests } from "../entities/quests.ts";
import {
  type EpicResource,
  epicResourceSchema,
} from "../schemas/epicResourceSchema.ts";
import { FolioLinkService } from "../services/FolioLinkService.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * CRUD, the status lifecycle, and attach/detach for quests and folios.
 *
 * Same `$secure` permission strings as `MilestoneController`
 * (`quest:read` to read, `quest:create` to mutate, `quest:delete` on
 * `deleteEpic` — matching `MilestoneController.deleteMilestone` and
 * `QuestController.deleteQuest`, both of which gate delete on its own
 * permission rather than `quest:create`), and `$transactional()` on create.
 *
 * **Every endpoint here is `security.assertMember`, read and write alike** —
 * the `QuestController` / `FolioController` rule, not the
 * `MilestoneController` one it was originally modelled on. An epic groups
 * quests and folios, both of which any member may already create, rename
 * and delete; gating the grouping on ownership meant the header's "Create
 * epic" entry (shown to every member, `ProjectActionsCreateButton`) answered
 * 403, and an epic a member could not activate or attach anything to would
 * be inert anyway. `deleteEpic` follows `QuestController.deleteQuest`, which
 * is member-gated for the same reason.
 *
 * Project *configuration* stays owner-only — that split lives in
 * `ProjectController` and `MilestoneController`, not here.
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
  security = $inject(ProjectSecurityService);
  linkService = $inject(FolioLinkService);

  /**
   * Per-project sequence for `epics.number`. `$sequence` keys its counter
   * on the PROPERTY NAME — renaming this property restarts every
   * project's counter at 1. A rename needs an `UPDATE alepha_sequences
   * SET name` in the migration, exactly as `chapterNumber` →
   * `milestoneNumber` did.
   */
  protected epicNumber = $sequence();

  getEpics = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.array(epicResourceSchema),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const allEpics = await this.epics.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "asc" }],
      });

      return await Promise.all(
        allEpics.map((epic) => this.buildEpicResource(epic)),
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
    use: [$secure({ permissions: ["quest:read"] })],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.object({ count: z.integer() }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const count = await this.epics.count({
        projectId: { eq: params.projectId },
        status: { eq: "planned" },
      });

      return { count };
    },
  });

  getEpicByNumber = $action({
    use: [$secure({ permissions: ["quest:read"] })],
    path: "/projects/:projectId/epics/:number",
    schema: {
      params: z.object({
        projectId: z.integer(),
        number: z.integer(),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, user }) => {
      const epic = await this.epics.getOne({
        where: {
          projectId: { eq: params.projectId },
          number: { eq: params.number },
        },
      });

      await this.security.assertMember(epic.projectId, user);

      return await this.buildEpicResource(epic);
    },
  });

  createEpic = $action({
    use: [$secure({ permissions: ["quest:create"] }), $transactional()],
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        title: z.string().min(3).max(80),
        description: z.string().meta({ size: "rich" }).optional(),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertMember(params.projectId, user);
      const number = await this.epicNumber.next(String(params.projectId));
      const epic = await this.epics.create({
        projectId: params.projectId,
        number,
        title: body.title,
        description: body.description ?? "",
        status: "planned",
      });
      await this.syncEpicLinks(epic);

      return await this.buildEpicResource(epic);
    },
  });

  updateEpic = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        title: z.string().min(3).max(80).optional(),
        description: z.string().meta({ size: "rich" }).optional(),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

      const updated = await this.epics.updateById(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
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
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        status: z.enum(["planned", "active", "done"]),
      }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

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
    use: [$secure({ permissions: ["quest:delete"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

      // `folio_links.from_id` is not a foreign key, so the FK cascade this
      // delete relies on for quests and folios does not reach the link
      // graph — see `FolioLinkService.deleteLinksFrom`.
      await this.linkService.deleteLinksFrom({ kind: "epic", id: params.id });
      await this.epics.deleteById(params.id, { force: true });

      return { ok: true };
    },
  });

  attachQuest = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ questId: z.integer() }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

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
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer(), questId: z.integer() }),
      response: epicResourceSchema,
    },
    handler: async ({ params, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

      const quest = await this.quests.getById(params.questId);
      if (quest.epicId === epic.id) {
        await this.quests.updateById(quest.id, { epicId: null });
      }

      return await this.buildEpicResource(epic);
    },
  });

  attachFolio = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ folioId: z.uuid() }),
      response: epicResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

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
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({ id: z.integer(), folioId: z.uuid() }),
      response: epicResourceSchema,
    },
    handler: async ({ params, user }) => {
      const epic = await this.epics.getById(params.id);
      await this.security.assertMember(epic.projectId, user);

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
    const progress = await this.computeProgress(epic);
    return { ...epic, progress, questCount: progress.total };
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
  protected async computeProgress(epic: Epic): Promise<{
    completed: number;
    inProgress: number;
    shelved: number;
    total: number;
  }> {
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
}
