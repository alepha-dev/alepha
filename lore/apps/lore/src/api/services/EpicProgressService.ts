import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { quests } from "../entities/quests.ts";
import type { EpicResource } from "../schemas/epicResourceSchema.ts";
import { BoundParameters } from "./BoundParameters.ts";

/**
 * The rollup `epicResourceSchema.progress` carries, named once so the
 * per-epic and batched paths cannot disagree on its shape.
 */
export type EpicProgress = EpicResource["progress"];

/**
 * The four buckets over an epic's quests, in ONE place.
 *
 * ⚠️ It lives on a service rather than on `EpicController` (where it was
 * written) for exactly the reason `ReleaseContentService.progressOf` does:
 * the Epics list, `epic_list`, `project_context`, MCP output and now the
 * dashboard's epic card all need the same answer, and a second copy of it is
 * the silent disagreement a shared service exists to prevent - two surfaces
 * counting different things with nothing going red.
 *
 * ⚠️ **`total` counts every quest of the epic, INCLUDING the shelved ones**,
 * and that is deliberate rather than an oversight. It is NOT the same
 * denominator as `ReleaseContentService.progressOf`, which counts `shelved`
 * outside its `total`. Nothing here may quietly reconcile the two: this
 * number is read by four surfaces and changing it would move all of them. A
 * caller that wants shelved work out of its denominator subtracts at the
 * call site and says so on screen - see `EpicProgressMetric`, which does.
 */
export class EpicProgressService {
  protected readonly quests = $repository(quests);
  protected readonly bound = $inject(BoundParameters);

  /**
   * `computeProgress` for a whole page of epics, in ONE query whatever the
   * page holds — the batched sibling, not a replacement. The single-epic
   * callers (`getEpicByNumber`, the create/update/status hops) keep
   * `computeProgress`, where four counts is already the right shape.
   *
   * Three of the four buckets are a plain `count` on a nullable column,
   * which compiles to `COUNT(col)` and so skips NULLs: counting
   * `completedAt` counts the quests that have one. The fourth is a
   * conjunction — accepted AND NOT completed — which no single column count
   * expresses, so it is a conditioned aggregate: `count` over `id` with its
   * own `where`, which compiles to `COUNT(CASE WHEN ... THEN id END)`.
   *
   * ⚠️ Not `COUNT(accepted_at) - COUNT(completed_at)`, which would also be
   * one pass but only if "completed implies accepted" held. Nothing in
   * `quests` states that, so the derivation would be silently wrong the
   * first time a quest is completed without being accepted.
   *
   * ⚠️ The conditioned bucket counts `id` and not `acceptedAt`, because
   * `COUNT(CASE WHEN c THEN col END)` skips NULLs of `col` as well as rows
   * failing `c` — and the primary key is the column that is never null.
   *
   * `aggregate()` applies `withOrganization` / `withDeletedAt` exactly like
   * `count()`, and the per-aggregate `where` narrows inside the CASE rather
   * than replacing that clause, so the tenancy and soft-delete filtering is
   * unchanged.
   */
  async computeProgressOf(
    epicIds: number[],
  ): Promise<Map<number, EpicProgress>> {
    const progress = new Map<number, EpicProgress>();
    // `inArray: []` throws, so a project with no epics never reaches the
    // query. An empty map is the right answer for it anyway.
    if (epicIds.length === 0) {
      return progress;
    }

    // Chunked: one bound parameter per epic, and nothing caps how many epics
    // a project has.
    const buckets = await this.bound.collect(epicIds, (batch) =>
      this.quests.aggregate({
        select: {
          epicId: true,
          id: { count: true },
          completedAt: { count: true },
          shelvedAt: { count: true },
          inProgress: {
            count: {
              column: "id",
              where: {
                acceptedAt: { isNotNull: true },
                completedAt: { isNull: true },
              },
            },
          },
        },
        where: { epicId: { inArray: batch } },
        groupBy: ["epicId"],
      }),
    );

    for (const row of buckets) {
      if (row.epicId == null) continue;
      progress.set(row.epicId, {
        completed: row.completedAt.count,
        inProgress: row.inProgress.count,
        shelved: row.shelvedAt.count,
        total: row.id.count,
      });
    }

    return progress;
  }
}
