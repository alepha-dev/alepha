import { type Infer, z } from "alepha";

import { releases } from "../entities/releases.ts";

/**
 * Release + the progress rollup, which is the single number that makes a
 * release worth opening.
 *
 * ⚠️ `progress` counts EVERY quest in the release, including the quests of a
 * `planned` epic that `EpicVisibilityService` keeps out of the project's own
 * backlog. Same reasoning as `epicResourceSchema`: a release reporting 0/23 is
 * telling the truth, one reporting 0/0 because its own work is gated out of a
 * listing surface is not.
 *
 * For a released release these four numbers come from the frozen columns
 * stamped at publish and are NEVER recomputed - see
 * `ReleaseController.progressOf`.
 */
export const releaseResourceSchema = releases.schema.extend({
  progress: z.object({
    completed: z.integer(),
    /**
     * Accepted but not yet completed. Disjoint from `completed` and from
     * `shelved` — a shelved quest is by definition still `new`, so the three
     * buckets never overlap and `total - completed - inProgress` is the count
     * still open and untouched.
     *
     * That subtraction has no `- shelved` in it, and that is not an
     * oversight: see the note on `shelved` below, and `releases.total`.
     */
    inProgress: z.integer(),
    /**
     * Deliberately set aside as out of scope, and NOT part of `total`.
     *
     * Counted here rather than folded into the open remainder because a row
     * that shows six shelved quests as "not done yet" reads as work
     * outstanding when it is work declined.
     */
    shelved: z.integer(),
    total: z.integer(),
  }),
});

export type ReleaseResource = Infer<typeof releaseResourceSchema>;
