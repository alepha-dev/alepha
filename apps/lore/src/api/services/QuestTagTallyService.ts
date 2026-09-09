import { $inject } from "alepha";
import { $repository, type PgQueryWhere } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";

/**
 * Completed versus remaining, per quest tag, in ONE place.
 *
 * ## There was never a choice to measure
 *
 * ⚠️ `quests.tags` is a JSON array in a text column, so **no `GROUP BY`
 * reaches inside it**, on D1 or anywhere else. Every filter over it is a
 * `like '%"value"%'` on the serialised blob, and `listQuestTags` reads the
 * whole column and folds it in memory for exactly this reason. #Q2083 asked
 * for a row count on Odzala before deciding; the answer is that "widen the
 * schema" was not an option, so the fold is not a compromise.
 *
 * ## Why it is a service
 *
 * Reports ▸ Quests shipped this fold inline (#Q2083); the dashboard's tag card
 * is the second reader, and two copies of a tally is the silent disagreement
 * `ReleaseContentService` exists to prevent one surface over. The controller
 * keeps its raw-SQL row read - it rides an aggregate query that is already
 * there - and hands the rows here.
 */
export class QuestTagTallyService {
  protected readonly quests = $repository(quests);
  protected readonly epicVisibility = $inject(EpicVisibilityService);

  /**
   * `quests.tags` as an array, whatever the driver handed back.
   *
   * ⚠️ Defensive on purpose rather than by habit. Reports reads this column
   * through raw SQL, so nothing decodes it on the way out: SQLite answers the
   * stored JSON string and a Postgres driver may answer either that string or
   * a parsed array depending on how the column landed. The tests and
   * production do not run the same engine, so branching on one of them would
   * be a fold that works in exactly one place.
   */
  parseTags(raw: unknown): string[] {
    const value =
      typeof raw === "string" && raw.length > 0 ? this.safeJson(raw) : raw;
    return Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [];
  }

  protected safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      // A column that is not the JSON it should be counts as no tags rather
      // than failing the whole report.
      return undefined;
    }
  }

  /**
   * Fold rows into one entry per tag.
   *
   * ⚠️ **A quest carrying two tags counts in BOTH**, so these entries do not
   * sum to the project's quest count and do not partition it. Reports says so
   * in a line under its heading; a single-tag card has to say it too, because
   * one number on its own hides the overlap entirely.
   */
  tally(
    rows: Array<{ tags: unknown; completed: boolean }>,
  ): Map<string, { completed: number; remaining: number }> {
    const tally = new Map<string, { completed: number; remaining: number }>();
    for (const row of rows) {
      for (const tag of this.parseTags(row.tags)) {
        const entry = tally.get(tag) ?? { completed: 0, remaining: 0 };
        if (row.completed) entry.completed += 1;
        else entry.remaining += 1;
        tally.set(tag, entry);
      }
    }
    return tally;
  }

  /**
   * The rows the fold reads, for a set of projects.
   *
   * The same in-scope rule Reports applies, written as a where-object rather
   * than as SQL because this caller has no aggregate to ride along with:
   *
   * - soft-deleted and shelved quests are out, so a declined quest leaves both
   *   the numerator and the denominator,
   * - and an OPEN quest inside a `planned` epic is out too, because it is
   *   specified rather than released.
   *
   * ⚠️ **Completed quests are exempt from the backlog gate**, exactly as
   * `ProjectReportsController.questInScope` exempts them, and for its stated
   * reason: nothing stops an owner flipping a `done` epic back to `planned`,
   * and gating finished work would retroactively erase it from the numbers.
   */
  async rowsFor(
    projectIds: number[],
  ): Promise<Array<{ projectId: number; tags: unknown; completed: boolean }>> {
    if (projectIds.length === 0) {
      return [];
    }

    const where: PgQueryWhere<typeof quests.schema> = {
      projectId: { inArray: projectIds },
      shelvedAt: { isNull: true },
    };

    const planned: number[] = [];
    for (const projectId of projectIds) {
      planned.push(...(await this.epicVisibility.plannedEpicIds(projectId)));
    }

    if (planned.length > 0) {
      // ⚠️ The `isNull` branch is mandatory, not defensive: `epic_id NOT IN
      // (…)` is SQL NULL for a quest with no epic, and a NULL predicate
      // excludes the row - which would hide the entire backlog. The third
      // branch is the completed exemption above.
      where.or = [
        { completedAt: { isNotNull: true } },
        { epicId: { isNull: true } },
        { epicId: { notInArray: planned } },
      ];
    }

    const rows = await this.quests.findMany({
      where,
      columns: ["projectId", "tags", "completedAt"],
    });

    return rows.map((row) => ({
      projectId: row.projectId,
      tags: row.tags,
      completed: row.completedAt != null,
    }));
  }
}
