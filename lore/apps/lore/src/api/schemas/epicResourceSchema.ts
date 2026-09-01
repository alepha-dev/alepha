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
});

export type EpicResource = Infer<typeof epicResourceSchema>;
