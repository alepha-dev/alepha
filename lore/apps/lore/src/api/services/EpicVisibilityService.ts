import { $repository, type PgQueryWhere } from "alepha/orm";
import { epics } from "../entities/epics.ts";
import type { quests } from "../entities/quests.ts";

/**
 * The single place the backlog gate is computed.
 *
 * A quest inside a `planned` epic keeps `status: "new"` and
 * `shelvedAt: undefined` — the gate NEVER writes to a quest row.
 * Activating an epic is one write that releases all of its quests.
 *
 * Every UI listing surface calls `applyBacklogGate`. Duplicating the
 * predicate is how the 13-endpoint precondition bug happened (folio #20).
 */
export class EpicVisibilityService {
  protected readonly epics = $repository(epics);

  /**
   * Ids of the project's epics that are still `planned`. Typically empty
   * or a handful, which is why the gate can be a two-step lookup rather
   * than a join.
   */
  async plannedEpicIds(projectId: number): Promise<number[]> {
    const planned = await this.epics.findMany({
      where: {
        projectId: { eq: projectId },
        status: { eq: "planned" },
      },
      columns: ["id"],
    });
    return planned.map((epic) => epic.id);
  }

  /**
   * Mutates `where` in place, adding the backlog gate.
   *
   * ⚠️ Two traps, both load-bearing:
   *
   * 1. The `isNull` branch is MANDATORY, not defensive. `epic_id NOT IN
   *    (1,2)` evaluates to SQL NULL when `epic_id` is NULL, and a NULL
   *    predicate excludes the row — so a bare `notInArray` hides every
   *    quest that has no epic, i.e. the entire backlog.
   * 2. `notInArray: []` THROWS. A project with zero planned epics is the
   *    normal case, so we return early rather than pass an empty array.
   *
   * The top-level `or` is ANDed with the caller's sibling keys by
   * `QueryManager.toSQL`, so the caller's `projectId` scoping survives.
   */
  async applyBacklogGate(
    where: PgQueryWhere<typeof quests.schema>,
    projectId: number,
  ): Promise<void> {
    const plannedIds = await this.plannedEpicIds(projectId);

    if (plannedIds.length === 0) {
      return;
    }

    where.or = [
      { epicId: { isNull: true } },
      { epicId: { notInArray: plannedIds } },
    ];
  }
}
