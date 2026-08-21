import { $inject } from "alepha";
import { $repository, type PgQueryWhere } from "alepha/orm";
import { quests } from "../entities/quests.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";

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
 *   out of scope", a different fact from a planned epic's "not released yet",
 *   and the two must never be conflated again.
 * - plus the planned-epic backlog gate, whose two traps live in
 *   `EpicVisibilityService`.
 */
export class OpenQuestScope {
  protected readonly quests = $repository(quests);
  protected readonly epicVisibility = $inject(EpicVisibilityService);

  /** The gated where-object, ready for a `count` or a `findMany`. */
  async where(
    projectIds: number[],
  ): Promise<PgQueryWhere<typeof quests.schema>> {
    const where = this.quests.createQueryWhere();
    where.projectId = { inArray: projectIds };
    where.completedAt = { isNull: true };
    where.shelvedAt = { isNull: true };
    await this.epicVisibility.applyBacklogGateAcross(where, projectIds);
    return where;
  }

  /**
   * Open quests per project, for a list of projects.
   *
   * One statement for the whole list rather than one per project: the
   * dashboard rail asks about every project the reader belongs to, and a
   * count-per-row loop on a Worker is a network round-trip per row.
   */
  async countByProject(projectIds: number[]): Promise<Map<number, number>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const rows = await this.quests.findMany({
      where: await this.where(projectIds),
      columns: ["projectId"],
    });

    const tally = new Map<number, number>();
    for (const row of rows) {
      tally.set(row.projectId, (tally.get(row.projectId) ?? 0) + 1);
    }
    return tally;
  }
}
