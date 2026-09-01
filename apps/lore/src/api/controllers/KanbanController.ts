import { $inject, z } from "alepha";
import { $repository, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import { projects } from "../entities/projects.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { projectResourceSchema } from "../schemas/projectResourceSchema.ts";
import { byPriorityDesc } from "../schemas/questPriority.ts";
import { questResourceSchema } from "../schemas/questResourceSchema.ts";
import { BoardRank } from "../services/BoardRank.ts";
import { EpicVisibilityService } from "../services/EpicVisibilityService.ts";
import { ProjectResourceMapper } from "../services/ProjectResourceMapper.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { QuestResourceMapper } from "../services/QuestResourceMapper.ts";

export class KanbanController {
  protected projects = $repository(projects);
  protected quests = $repository(quests);
  protected security = $inject(ProjectSecurityService);
  protected epicVisibility = $inject(EpicVisibilityService);
  protected questMapper = $inject(QuestResourceMapper);
  protected projectMapper = $inject(ProjectResourceMapper);
  protected rank = $inject(BoardRank);

  /**
   * Get all quests for a project, grouped for kanban display. Members
   * only — Lore projects are private, there is no public-share path.
   */
  getBoard = $action({
    use: [$secure({ permissions: ["quest:read"] })],
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
      const { project } = await this.security.assertMember(
        params.projectId,
        user,
      );

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
        project: this.projectMapper.toResource(project),
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
    use: [$secure({ permissions: ["quest:update"] }), $transactional()],
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
      const quest = await this.quests.getOne({
        where: { id: { eq: params.id } },
      });
      await this.security.assertMember(quest.projectId, user);

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

      quest.boardRank = this.rank.between(before, after);
      await this.quests.save(quest);
      return this.questMapper.mapQuestToResource(quest);
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
      // Within `accepted`, the sub-column is part of the identity: two
      // lanes side by side are two independent orderings.
      if (status !== "accepted") return true;
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
}
