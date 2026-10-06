import {
  $ownsProject,
  ProjectResourceMapper,
  ProjectSecurityService,
} from "@lore/core/api";
import { type Project, projects } from "@lore/core/schemas";
import { projectResourceSchema } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider } from "alepha/security";
import { $action, BadRequestError } from "alepha/server";

import { type Quest, quests } from "../entities/quests.ts";
import { byPriorityDesc } from "../schemas/questPriority.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { BoardRank } from "../services/BoardRank.ts";
import { EpicVisibilityService } from "../services/EpicVisibilityService.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class KanbanController {
  protected projects = $repository(projects);
  protected quests = $repository(quests);
  protected security = $inject(ProjectSecurityService);
  protected epicVisibility = $inject(EpicVisibilityService);
  protected questMapper = $inject(QuestResourceMapper);
  protected projectMapper = $inject(ProjectResourceMapper);
  protected rank = $inject(BoardRank);
  protected owned = $inject(OwnedResourceProvider);

  /**
   * Get all quests for a project, grouped for kanban display. Members
   * only — Lore projects are private, there is no public-share path.
   */
  getBoard = $action({
    use: [$ownsProject({ requires: "quest:read", param: "projectId" })],
    method: "GET",
    path: "/kanban/:projectId",
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.object({
        project: projectResourceSchema,
        quests: z.array(questResourceSchema),
      }),
    },
    handler: async ({ params, user }) => {
      // The row the gate already read, rather than a second lookup of it.
      const project = this.owned.get<Project>();

      const where = this.quests.createQueryWhere();
      where.projectId = { eq: params.projectId };
      // The board has no shelf lane — a shelved quest would otherwise
      // land back in "New", which is exactly the clutter shelving is
      // meant to remove. Unshelve from the quest view to get it back.
      where.shelvedAt = { isNull: true };

      // Same gate as `QuestController.getQuests`, and it has to be the same
      // one: a quest visible on the board but absent from the list (or the
      // reverse) is precisely the inconsistency this feature exists to
      // prevent. The board has no opt-out — it is a pure UI surface, unlike
      // `getQuests`, which MCP `quest_list` also calls.
      await this.epicVisibility.applyBacklogGate(where, params.projectId);

      const allQuests = await this.quests.findMany({
        where,
        // ⚠️ Deliberately NOT `priority desc`. `quests.priority` is a text
        // enum, so SQL sorts the label, and the labels run
        // `optional > medium > low > high` — the reverse of severity.
        // Priority is applied in `orderForBoard`, which can use the ordinal;
        // this leaves the query producing only the tie-break order.
        orderBy: [{ column: "updatedAt", direction: "desc" }],
      });

      return {
        project: this.projectMapper.toResource(
          project,
          // Memoized per request, so a board opened inside the same
          // `_batch` as the project read pays for this once.
          await this.security.capabilityRowsOf(params.projectId),
        ),
        quests: this.orderForBoard(allQuests).map((quest) =>
          this.questMapper.mapQuestToResource(quest),
        ),
      };
    },
  });

  /**
   * Place a card at an explicit position within its column.
   *
   * The client names the two cards the drop landed between rather than a
   * rank or an index: an index goes stale the moment anyone else moves a
   * card, and a rank computed client-side would let two browsers pick the
   * same one. Neighbours are stable — if they have moved too, the worst
   * case is the card landing beside a card that has itself shifted, which
   * is what the user was aiming at anyway.
   *
   * Omit `beforeQuestId` to drop at the head, `afterQuestId` for the tail.
   */
  moveQuestOnBoard = $action({
    use: [
      $ownsProject({
        requires: "quest:update",
        repository: () => this.quests,
        param: "id",
      }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        beforeQuestId: z.integer().optional(),
        afterQuestId: z.integer().optional(),
      }),
      response: questResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const quest = this.owned.get<Quest>();

      // The column as the board shows it, which is what the neighbours the
      // client sent were picked from.
      const column = await this.columnOf(quest);

      // Rank the whole column on first use. Doing it here rather than in a
      // migration is what let `board_rank` ship as a bare ADD COLUMN on
      // `quests` — the CASCADE parent a rebuild would empty.
      //
      // ⚠️ This loop is one D1 round trip per quest and is DELIBERATELY
      // left that way. Every row takes a different rank, so it cannot
      // collapse into an `updateMany` the way the column rename and the
      // dependents clear did; `Repository` exposes no way to send N
      // statements in one round trip, and `Promise.all` does not overlap
      // D1 round trips on this stack. Deferring it to a job is not open
      // either: the move computes its own rank from `rankOf`, which reads
      // the ranks this loop has just written, so the backfill has to be
      // visible to the request that triggered it. It runs once per column,
      // on the first drag. Revisit if the ORM ever grows a batch API.
      if (column.some((row) => !row.boardRank)) {
        const ranks = this.rank.sequence(column.length);
        for (const [index, row] of column.entries()) {
          row.boardRank = ranks[index];
          await this.quests.updateById(row.id, { boardRank: ranks[index] });
        }
      }

      const rankOf = (id?: number) =>
        id == null
          ? undefined
          : column.find((row) => row.id === id)?.boardRank || undefined;

      const before = rankOf(body.beforeQuestId);
      const after = rankOf(body.afterQuestId);

      // The rank alone, not a `save()` of the whole row: a drag must never
      // revert a concurrent edit, nor answer 409 because somebody renamed
      // the quest meanwhile (#Q2546).
      const moved = await this.quests.updateById(quest.id, {
        boardRank: this.rank.between(before, after),
      });
      return this.questMapper.mapQuestToResource(moved);
    },
  });

  /**
   * Every quest sharing a lane with this one, in board order — the same
   * filter and sort `getBoard` applies, because the neighbour ids the
   * client sends were read off exactly that list.
   */
  protected async columnOf(quest: Quest): Promise<Quest[]> {
    const where = this.quests.createQueryWhere();
    where.projectId = { eq: quest.projectId };
    where.shelvedAt = { isNull: true };
    await this.epicVisibility.applyBacklogGate(where, quest.projectId);

    const rows = await this.quests.findMany({
      where,
      // ⚠️ Deliberately NOT `priority desc`. `quests.priority` is a text
      // enum, so SQL sorts the label, and the labels run
      // `optional > medium > low > high` — the reverse of severity.
      // Priority is applied in `orderForBoard`, which can use the ordinal;
      // this leaves the query producing only the tie-break order.
      orderBy: [{ column: "updatedAt", direction: "desc" }],
    });

    const status = this.questMapper.questStatus(quest);
    return this.orderForBoard(rows).filter((row) => {
      if (this.questMapper.questStatus(row) !== status) return false;
      // Within `in_progress`, the sub-column is part of the identity: two
      // lanes side by side are two independent orderings.
      if (status !== "in_progress") return true;
      return (
        (row.kanbanColumn ?? undefined) === (quest.kanbanColumn ?? undefined)
      );
    });
  }

  /**
   * Apply manual card order on top of the default sort.
   *
   * Sorted here rather than in SQL because the rule is "ranked cards in
   * rank order, everything else in the order the query already produced",
   * and expressing a NULLS-LAST secondary sort portably across SQLite,
   * Postgres and the in-memory driver costs more than one stable sort over
   * a set the board loads whole anyway.
   *
   * It is also where PRIORITY is applied, because `quests.priority` is a
   * text enum SQL cannot order meaningfully — see `QUEST_PRIORITY_ORDER`.
   *
   * Ranks are assigned per column, so in practice a column is either fully
   * ranked or fully unranked and this never actually interleaves the two.
   * The nulls-last rule is what makes the mixed case defined regardless:
   * a quest created into an already-ranked column lands at the bottom,
   * which is where a new card belongs.
   */
  protected orderForBoard(rows: Quest[]): Quest[] {
    return rows
      .map((quest, index) => ({ quest, index }))
      .sort((a, b) => {
        const rankA = a.quest.boardRank;
        const rankB = b.quest.boardRank;
        if (rankA && rankB) {
          return rankA < rankB ? -1 : rankA > rankB ? 1 : a.index - b.index;
        }
        if (rankA) return -1;
        if (rankB) return 1;
        // Neither ranked: most urgent first, then the query's own order
        // (`updatedAt desc`) as the tie-break. The ordinal is what makes
        // this correct — see `QUEST_PRIORITY_ORDER`.
        const byPriority = byPriorityDesc(a.quest, b.quest);
        return byPriority !== 0 ? byPriority : a.index - b.index;
      })
      .map((entry) => entry.quest);
  }

  // ── Kanban column CRUD ──────────────────────────────────────────────
  //
  // Moved here from `ProjectController` (#E75, #Q2623): the columns are
  // stored on `projects` (core's table, which Work may write), but a rename
  // cascades onto `quests` and a delete counts them, which core may not
  // read. Names and paths are unchanged (`/addKanbanColumn/:id`...): an
  // `$action`'s default path is its name and params, never its class.

  /**
   * The project in `:id`, gated like every other project write.
   */
  protected ownsProject = (requires: string | string[]) =>
    $ownsProject({ requires, param: "id" });

  addKanbanColumn = $action({
    use: [this.ownsProject("project:update")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        name: z.string().min(1).max(24),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      const name = body.name.trim();
      if (!name) {
        throw new BadRequestError("Column name must not be empty.");
      }
      if (current.length >= 5) {
        throw new BadRequestError(
          "A project can have at most 5 kanban columns.",
        );
      }
      if (current.includes(name)) {
        throw new BadRequestError("A column with this name already exists.");
      }
      const updated = [...current, name];
      await this.projects.updateById(params.id, { kanbanColumns: updated });
      return updated;
    },
  });

  renameKanbanColumn = $action({
    use: [this.ownsProject("project:update")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        oldName: z.string(),
        newName: z.string().min(1).max(24),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      const newName = body.newName.trim();
      if (!current.includes(body.oldName)) {
        throw new BadRequestError("Column not found.");
      }
      if (newName === body.oldName) return current;
      if (current.includes(newName)) {
        throw new BadRequestError("A column with this name already exists.");
      }

      // Cascade-rename onto every quest that lives in that column, in ONE
      // statement. It used to read the column and then update row by row,
      // which is unbounded in the size of the column: on D1 each update is
      // a round trip, so a column holding 400 quests was several seconds of
      // them against a 5000 ms `DATABASE_TIMEOUT`.
      await this.quests.updateMany(
        {
          projectId: { eq: params.id },
          kanbanColumn: { eq: body.oldName },
        },
        { kanbanColumn: newName },
      );

      const updated = current.map((c) => (c === body.oldName ? newName : c));
      // The settings map is keyed by name, so a rename has to carry the
      // entry across or the column silently loses its status and its WIP
      // limit — which for a `completed` column would quietly turn it back
      // into an in-progress lane.
      const config = { ...project.kanbanColumnConfig };
      if (config[body.oldName]) {
        config[newName] = config[body.oldName];
        delete config[body.oldName];
      }
      await this.projects.updateById(params.id, {
        kanbanColumns: updated,
        // `null` for the same reason the delete path uses it: `undefined`
        // reads as "leave unchanged", so a rename that empties the map would
        // leave the OLD name's entry behind.
        kanbanColumnConfig: Object.keys(config).length ? config : null,
      });
      return updated;
    },
  });

  deleteKanbanColumn = $action({
    use: [this.ownsProject("project:update")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({ name: z.string() }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      if (!current.includes(body.name)) {
        throw new BadRequestError("Column not found.");
      }
      if (current.length <= 1) {
        throw new BadRequestError("A project must keep at least one column.");
      }

      // Refuse if any quest still lives in this column.
      const occupants = await this.quests.count({
        projectId: { eq: params.id },
        kanbanColumn: { eq: body.name },
      });
      if (occupants > 0) {
        throw new BadRequestError(
          "Move or complete the quests in this column before deleting it.",
        );
      }

      const updated = current.filter((c) => c !== body.name);
      // Drop the deleted column's settings too. Leaving them would be inert
      // today, but re-creating a column with the same name would silently
      // resurrect a status and a WIP limit nobody asked for.
      const remainingConfig = { ...project.kanbanColumnConfig };
      delete remainingConfig[body.name];
      // ⚠️ `null`, not `undefined`, when the map empties. An undefined patch
      // value means "leave unchanged" to `updateById`, so emptying the map
      // used to write nothing at all: the last configured column's settings
      // survived its deletion, and re-creating a column with that name
      // silently resurrected them - the exact outcome the comment above says
      // this code exists to prevent. Reproduced on a live board (#1511):
      // delete a violet column, add one back with the same name, and it
      // comes back violet.
      await this.projects.updateById(params.id, {
        kanbanColumns: updated,
        kanbanColumnConfig: Object.keys(remainingConfig).length
          ? remainingConfig
          : null,
      });
      return updated;
    },
  });

  reorderKanbanColumns = $action({
    use: [this.ownsProject("project:update")],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        columns: z.array(z.string()).min(1).max(5),
      }),
      response: z.array(z.string()),
    },
    handler: async ({ params, body, user }) => {
      const project = this.owned.get<Project>();
      const current = project.kanbanColumns ?? [];
      // Must reorder the exact same set — additions/removals go through the
      // dedicated endpoints so concurrent edits can't drop a column silently.
      if (
        body.columns.length !== current.length ||
        new Set(body.columns).size !== body.columns.length ||
        body.columns.some((c) => !current.includes(c))
      ) {
        throw new BadRequestError(
          "Reordered list must contain the same columns.",
        );
      }
      await this.projects.updateById(params.id, {
        kanbanColumns: body.columns,
      });
      return body.columns;
    },
  });
}
