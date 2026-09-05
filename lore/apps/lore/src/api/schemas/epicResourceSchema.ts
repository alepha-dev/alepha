import { type Infer, z } from "alepha";

import { epics } from "../entities/epics.ts";

/**
 * Epic + server-computed rollup.
 *
 * `progress` counts EVERY quest in the epic, planned-gated ones included.
 * The backlog gate (`EpicVisibilityService`) is about the project's OWN
 * lists, not about the epic's view of itself: an epic reporting 0/13 is
 * telling the truth, one reporting 0/0 because its own quests are hidden
 * from it is not. `EpicController` never calls `applyBacklogGate` /
 * `plannedEpicSqlPredicate` when building this rollup.
 *
 * `questCount` restates `progress.total` as a bare number, for callers
 * that only want a headline count without unpacking the completed/total
 * pair (the MCP `epic_list` index, `project_context`'s epic index).
 */
export const epicResourceSchema = epics.schema.extend({
  progress: z.object({
    completed: z.integer(),
    /**
     * Accepted but not yet completed. Disjoint from `completed` and from
     * `shelved` — a shelved quest is by definition still `new` (see
     * `quests.shelvedAt`), so the three buckets never overlap and
     * `total - completed - inProgress - shelved` is the count still open
     * and untouched.
     */
    inProgress: z.integer(),
    /**
     * Deliberately set aside as out of scope. Counted here rather than
     * folded into the open remainder because a list row that shows six
     * shelved quests as "not done yet" reads as work outstanding when it
     * is work declined.
     */
    shelved: z.integer(),
    total: z.integer(),
  }),
  questCount: z.integer(),
  /**
   * `dependsOn` restated as the predecessor's per-project `number`.
   *
   * The column stores an id, because that is what a foreign key is; every
   * surface that names an epic to a human names it `#7`. Resolving it once
   * here, rather than at each call site, is what lets the roadmap, the MCP
   * tools and the epic page all say "after Epic 7" without any of them
   * holding the epic list to translate with.
   *
   * Absent when the epic has no predecessor, and also when the predecessor
   * row has gone - the FK is `ON DELETE SET NULL`, so that second case does
   * not survive a delete, but a soft-deleted one would.
   */
  dependsOnNumber: z.integer().optional(),
  /**
   * The predecessor's status, beside its number, present exactly when
   * `dependsOnNumber` is.
   *
   * It exists because `dependsOn` is a gate since epic #31: Begin is refused
   * while the predecessor is not `done`, and a Begin refused for a predecessor
   * nobody can see reads as a bug. With this, the epic page can say "Blocked
   * by Epic 7" on the disabled button and "After Epic 7" once the predecessor
   * concludes, without holding the epic list to look the status up.
   *
   * Computed, never stored: both resource builders already hold the
   * predecessor row for its number (`buildEpicResource` fetches it,
   * `getEpics` has every predecessor in hand), so it costs no query and no
   * migration.
   *
   * ⚠️ NOT picked into `roadmapEpicSchema`. The roadmap draws order, may be
   * public, and its key set is pinned; the predecessor may sit in no release
   * at all, and its status is not the roadmap's to disclose.
   */
  dependsOnStatus: epics.schema.shape.status.optional(),
});

export type EpicResource = Infer<typeof epicResourceSchema>;
