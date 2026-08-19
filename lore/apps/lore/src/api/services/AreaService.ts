import { AlephaError } from "alepha";
import { $repository } from "alepha/orm";
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
   * dozens of areas and this runs on every settings page load. Same
   * shape as the `ProjectController.getAreas` it replaces.
   */
  async listWithStats(projectId: number): Promise<AreaStats[]> {
    const [rows, projectQuests] = await Promise.all([
      this.areas.findMany({
        where: { projectId: { eq: projectId } },
        orderBy: [{ column: "name", direction: "asc" }],
      }),
      this.quests.findMany({ where: { projectId: { eq: projectId } } }),
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
      throw new AlephaError("An area name cannot be blank");
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
      throw new AlephaError("An area cannot be merged into itself");
    }
    if (sourceIds.length === 0) {
      return { movedQuests: 0 };
    }

    const target = await this.areas.getById(targetId);
    if (target.projectId !== projectId) {
      throw new AlephaError("Target area belongs to a different project");
    }

    const sources = await this.areas.findMany({
      where: { id: { inArray: sourceIds } },
    });
    if (sources.length !== sourceIds.length) {
      throw new AlephaError("One or more source areas do not exist");
    }
    for (const source of sources) {
      if (source.projectId !== projectId) {
        throw new AlephaError("Source area belongs to a different project");
      }
    }

    const movedQuests = await this.moveQuests(
      projectId,
      sources.map((s) => s.name),
      target.name,
    );

    for (const source of sources) {
      await this.areas.deleteById(source.id);
    }

    return { movedQuests };
  }

  /**
   * One `updateMany`, never a per-quest loop. The `renameArea` this
   * replaces issued one round-trip per quest despite `updateMany` being
   * used twenty lines above it in the same controller.
   */
  protected async moveQuests(
    projectId: number,
    fromNames: string[],
    toName: string,
  ): Promise<number> {
    const affected = await this.quests.findMany({
      where: {
        projectId: { eq: projectId },
        area: { inArray: fromNames },
      },
    });

    if (affected.length === 0) {
      return 0;
    }

    await this.quests.updateMany(
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
