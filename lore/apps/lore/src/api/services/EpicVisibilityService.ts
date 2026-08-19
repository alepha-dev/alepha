import { $repository, type PgQueryWhere, sql } from "alepha/orm";
import { epics } from "../entities/epics.ts";
import { quests } from "../entities/quests.ts";

/**
 * The single place the backlog gate is computed.
 *
 * A quest inside a `planned` epic keeps `status: "new"` and
 * `shelvedAt: undefined` — the gate NEVER writes to a quest row.
 * Activating an epic is one write that releases all of its quests.
 *
 * Every UI listing surface calls `applyBacklogGate`. Duplicating the
 * predicate is how the 13-endpoint precondition bug happened (folio #20).
 *
 * It has two output forms because its callers are not alike: the listing
 * surfaces build a repository where-object, while the Reports aggregates
 * hand-write SQL. Both live here so each of the two traps below is written
 * exactly once — the SQL form gets neither for free, and drift between the
 * forms would be invisible to the typechecker.
 *
 * ⚠️ Two traps, both load-bearing:
 *
 * 1. The `isNull` / `IS NULL` branch is MANDATORY, not defensive.
 *    `epic_id NOT IN (1,2)` evaluates to SQL NULL when `epic_id` is NULL,
 *    and a NULL predicate excludes the row — so a bare `notInArray` hides
 *    every quest that has no epic, i.e. the entire backlog.
 * 2. An empty planned set must produce NO clause. `notInArray: []` throws,
 *    and `NOT IN ()` is a SQL syntax error rather than an empty match. A
 *    project with zero planned epics is the normal case.
 */
export class EpicVisibilityService {
  protected readonly epics = $repository(epics);

  /**
   * Read only for its `epicId` column, so both output forms below name the
   * same column instead of trusting each caller to pass the right one.
   */
  protected readonly quests = $repository(quests);

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
   * The top-level `or` is ANDed with the caller's sibling keys by
   * `QueryManager.toSQL`, so the caller's `projectId` scoping survives.
   *
   * See the class comment for the two traps this encodes.
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

  /**
   * The same membership test as a raw SQL fragment, for callers that
   * hand-write their predicates instead of using a repository where-object.
   *
   * Returns `undefined` when the project has no planned epic — trap 2 — and
   * the caller must then omit the clause entirely rather than substitute
   * anything for it.
   *
   * This answers only "is this quest outside every planned epic". Whether
   * that is the right question for a given aggregate is the caller's policy
   * decision, not this method's: see `ProjectReportsController.questInScope`,
   * which exempts completed quests from it.
   */
  plannedEpicSqlPredicate(plannedEpicIds: number[]) {
    if (plannedEpicIds.length === 0) {
      return undefined;
    }

    const column = this.quests.table.epicId;

    return sql`(${column} IS NULL OR ${column} NOT IN (${sql.join(
      plannedEpicIds.map((id) => sql`${id}`),
      sql`, `,
    )}))`;
  }
}
