import { $repository, type PgQueryWhere } from "alepha/orm";

import { quests } from "../entities/quests.ts";

/**
 * What "open quests" means, in one place.
 *
 * Three surfaces answer it and they sit next to each other on screen: the
 * sidebar badge, the dashboard's Active Quests tile, and the rail beside that
 * tile. Two numbers that disagree while visible together is not a rounding
 * difference, it is one of them lying — and this app has already shipped that
 * bug once, with a badge reading 2 over a visibly empty list.
 *
 * The definition:
 *
 * - `completedAt IS NULL` and `shelvedAt IS NULL`. `shelvedAt` means "decided
 *   out of scope", a different fact from a draft's "not ready yet", and the
 *   two must never be conflated again.
 * - `draftAt IS NULL`: a draft is not open work, whether it is loose or one of
 *   a `draft` epic's quests, held ones included.
 *
 * ⚠️ Every term is a top-level `IS NULL` conjunct, spelled as
 * `quests_open_idx` spells its `where`: that is what lets SQLite prove this
 * query implies the partial index's predicate (see the index on `quests`).
 */
export class OpenQuestScope {
  protected readonly quests = $repository(quests);

  /**
   * The where-object, ready for a `count` or a `findMany`.
   *
   * Async for the shape its callers await.
   */
  async where(
    projectIds: number[],
  ): Promise<PgQueryWhere<typeof quests.schema>> {
    const where = this.quests.createQueryWhere();
    where.projectId = { inArray: projectIds };
    where.completedAt = { isNull: true };
    where.shelvedAt = { isNull: true };
    where.draftAt = { isNull: true };
    return where;
  }

  /**
   * Open quests per project, for a list of projects.
   *
   * One statement for the whole list rather than one per project: the
   * dashboard rail asks about every project the reader belongs to, and a
   * count-per-row loop on a Worker is a network round-trip per row.
   *
   * ## Counted in SQL, not in the isolate
   *
   * It used to fetch every open quest's `projectId` and tally them here.
   * ⚠️ Be clear about the lever: this saves **no rows read**, because D1
   * bills rows visited either way and `quests_open_idx` is what changed
   * that number. What it saves is the wire and the allocation - 9 rows come
   * back where 354 did on production, and neither figure is the count.
   */
  async countByProject(projectIds: number[]): Promise<Map<number, number>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const rows = await this.quests.aggregate({
      select: { projectId: true, id: { count: true } },
      where: await this.where(projectIds),
      groupBy: ["projectId"],
    });

    // A project with nothing open produces no group, so it is absent rather
    // than zero. Every caller already defaults a miss to 0.
    return new Map(rows.map((row) => [row.projectId, Number(row.id.count)]));
  }
}
