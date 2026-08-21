import { AlephaError } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { type Area, areas } from "../entities/areas.ts";
import { quests } from "../entities/quests.ts";

export interface AreaStats extends Area {
  questCount: number;
  openQuestCount: number;
  firstQuestAt?: string;
  lastQuestAt?: string;
}

/**
 * The sole `$repository(areas)` holder, and the single place the merge
 * algorithm lives — `AreaController.renameArea` and
 * `AreaController.mergeAreas` are two doors onto the same room.
 *
 * Auth is deliberately NOT enforced here. Every caller is a controller
 * action that has already run `ProjectSecurityService.assertOwner`; a
 * service that re-checks would need a token it has no business holding.
 */
export class AreaService {
  areas = $repository(areas);
  quests = $repository(quests);

  /**
   * Area count per project, for a batch of projects at once — the Home
   * page's project cards need "how many areas" for every project the
   * viewer belongs to, and none of them can afford a query per row.
   *
   * Aggregated in memory from one `IN` query rather than a per-project
   * `count()`, same reasoning as `listWithStats`. Caller is trusted to
   * have already scoped `projectIds` to what the viewer may see; this
   * returns nothing more sensitive than a number.
   */
  async countByProjectIds(projectIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (projectIds.length === 0) {
      return counts;
    }

    const rows = await this.areas.findMany({
      where: { projectId: { inArray: projectIds } },
      columns: ["projectId"],
    });

    for (const row of rows) {
      counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
    }

    return counts;
  }

  /**
   * Find-or-create by name. This is what keeps "declare a new area by
   * writing a quest" working — `QuestService.createQuest` calls it, so
   * the picker's list and the quests' actual values can never diverge.
   *
   * Returns `undefined` for a blank name: an empty `area` is a valid
   * quest field but must not become a row.
   */
  async ensureArea(projectId: number, name: string): Promise<Area | undefined> {
    const trimmed = name.trim();
    if (!trimmed) {
      return undefined;
    }

    const existing = await this.areas.findOne({
      where: { projectId: { eq: projectId }, name: { eq: trimmed } },
    });
    if (existing) {
      return existing;
    }

    return await this.areas.create({ projectId, name: trimmed });
  }

  /**
   * Every area of a project with its rollup, name-sorted.
   *
   * One query for the areas and one for the quests, aggregated in
   * memory rather than N `count()` round-trips — a project can carry
   * dozens of areas and this runs on every settings page load, plus the
   * `project_context` MCP tool that promises "~2K tokens" and is called
   * first on every task. `columns` is load-bearing: without it this pulls
   * every quest whole — rich-text `description`, `history`, `objectives`
   * — to read four scalar fields.
   */
  async listWithStats(projectId: number): Promise<AreaStats[]> {
    const [rows, projectQuests] = await Promise.all([
      this.areas.findMany({
        where: { projectId: { eq: projectId } },
        orderBy: [{ column: "name", direction: "asc" }],
      }),
      this.quests.findMany({
        where: { projectId: { eq: projectId } },
        columns: ["area", "createdAt", "completedAt", "shelvedAt"],
      }),
    ]);

    const stats = new Map<
      string,
      {
        questCount: number;
        openQuestCount: number;
        first?: string;
        last?: string;
      }
    >();

    for (const quest of projectQuests) {
      if (!quest.area) continue;
      const at = this.toISOString(quest.createdAt);
      const prev = stats.get(quest.area) ?? {
        questCount: 0,
        openQuestCount: 0,
      };
      stats.set(quest.area, {
        questCount: prev.questCount + 1,
        openQuestCount:
          prev.openQuestCount +
          (!quest.completedAt && !quest.shelvedAt ? 1 : 0),
        first: prev.first && prev.first < at ? prev.first : at,
        last: prev.last && prev.last > at ? prev.last : at,
      });
    }

    return rows.map((row) => {
      const s = stats.get(row.name);
      return {
        ...row,
        questCount: s?.questCount ?? 0,
        openQuestCount: s?.openQuestCount ?? 0,
        firstQuestAt: s?.first,
        lastQuestAt: s?.last,
      };
    });
  }

  /**
   * Rename, or merge when the target name is already taken.
   *
   * The two are one operation from the caller's point of view — this is
   * the "smooth merging" the rework exists for, and the same behaviour
   * Linear's labels and Jira's components have. `merged` tells the UI
   * which happened so it can word the toast honestly.
   */
  async rename(
    areaId: number,
    name: string,
  ): Promise<{ merged: boolean; movedQuests: number; area: Area }> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestError("An area name cannot be blank");
    }

    const area = await this.areas.getById(areaId);
    if (area.name === trimmed) {
      return { merged: false, movedQuests: 0, area };
    }

    const target = await this.areas.findOne({
      where: { projectId: { eq: area.projectId }, name: { eq: trimmed } },
    });

    if (target) {
      const { movedQuests } = await this.merge(
        area.projectId,
        [area.id],
        target.id,
      );
      return { merged: true, movedQuests, area: target };
    }

    const movedQuests = await this.moveQuests(
      area.projectId,
      [area.name],
      trimmed,
    );
    const updated = await this.areas.updateById(areaId, { name: trimmed });

    return { merged: false, movedQuests, area: updated };
  }

  /**
   * Move every quest off `sourceIds` onto `targetId`, then drop the
   * source rows.
   *
   * ⚠️ Order is load-bearing. D1 gives no transaction across these two
   * statements, so quests move FIRST: a failure in between leaves an
   * empty source area, which is visible, harmless, and deletable. The
   * reverse order would strand quests on a name with no row and break
   * the `ensureArea` invariant.
   */
  async merge(
    projectId: number,
    sourceIds: number[],
    targetId: number,
  ): Promise<{ movedQuests: number }> {
    if (sourceIds.includes(targetId)) {
      throw new BadRequestError("An area cannot be merged into itself");
    }
    if (sourceIds.length === 0) {
      return { movedQuests: 0 };
    }

    const target = await this.areas.getById(targetId);
    if (target.projectId !== projectId) {
      throw new BadRequestError("Target area belongs to a different project");
    }

    const sources = await this.areas.findMany({
      where: { id: { inArray: sourceIds } },
    });
    if (sources.length !== sourceIds.length) {
      throw new AlephaError("One or more source areas do not exist");
    }
    for (const source of sources) {
      if (source.projectId !== projectId) {
        throw new BadRequestError("Source area belongs to a different project");
      }
    }

    const movedQuests = await this.moveQuests(
      projectId,
      sources.map((s) => s.name),
      target.name,
    );

    // `areas` carries `deletedAt`, so a plain `deleteMany` only stamps the
    // rows and never reaches a physical DELETE — `force: true` is what makes
    // this a real delete (see `EpicController.deleteEpic` for the same
    // trap). Without it, the source rows keep occupying their
    // `(projectId, name)` slot in `areas_project_id_name_idx` — which has
    // no `WHERE deleted_at IS NULL` clause — so the next `ensureArea` call
    // for that name finds nothing via `findOne` (which does filter
    // `deletedAt`) and tries to `create`, hitting the unique constraint.
    //
    // One statement, not a per-source loop: D1 gives no transaction here
    // (see the order note above), so N statements would mean N
    // partial-failure windows for no benefit — a single `deleteMany`
    // either drops every source row or none of them.
    await this.areas.deleteMany(
      { id: { inArray: sources.map((s) => s.id) } },
      { force: true },
    );

    return { movedQuests };
  }

  /**
   * One `updateMany`, never a per-quest loop. The `renameArea` this
   * replaces issued one round-trip per quest despite `updateMany` being
   * used twenty lines above it in the same controller.
   *
   * `updateMany` already returns the ids it touched, so the count comes
   * from `.length` — a separate `findMany` beforehand would re-scan the
   * exact rows this is about to update just to count them.
   */
  protected async moveQuests(
    projectId: number,
    fromNames: string[],
    toName: string,
  ): Promise<number> {
    const affected = await this.quests.updateMany(
      { projectId: { eq: projectId }, area: { inArray: fromNames } },
      { area: toName },
    );

    return affected.length;
  }

  protected toISOString(value: unknown): string {
    return typeof value === "string"
      ? value
      : new Date(value as never).toISOString();
  }
}
