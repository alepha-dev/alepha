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
    total: z.integer(),
  }),
  questCount: z.integer(),
});

export type EpicResource = Infer<typeof epicResourceSchema>;
