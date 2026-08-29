import { z } from "alepha";

import { quests } from "../../api/entities/quests.ts";

/**
 * Quest objective, as a tool hands one out.
 *
 * Derived from the column's own element rather than restated, so `title`,
 * `completed`, `waivedReason` and `waivedAt` have one definition. Two
 * deliberate departures from it:
 *
 * - `id` is REQUIRED here and optional on the column, because the server
 *   mints one for every objective and backfills legacy rows, so a read
 *   always carries it. It is what `quest_objective_set` addresses and what
 *   the quest's own history rows point at, which is why stripping it from
 *   the output (as this schema used to) turned every objectives replace into
 *   a silent renumbering.
 * - `waivedBy` is dropped: it is a raw uuid, and every other person on this
 *   surface is a display name.
 */
export const objectiveSchema = quests.schema.shape.objectives.element
  .omit({ waivedBy: true })
  .extend({
    id: z
      .integer()
      .describe(
        "Stable per-quest objective id. Pass it to `quest_objective_set` to tick one, and carry it back on `quest_update.objectives` so an edit stays an edit.",
      ),
    waivedReason: z
      .string()
      .describe(
        "Why this objective was closed WITHOUT being done, recorded when the quest was completed. Present means the box is unticked on purpose: the work did not happen and this says why. Never set alongside `completed: true`.",
      )
      .optional(),
  });
