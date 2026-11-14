import { z } from "alepha";

import { quests } from "../../api/entities/quests.ts";

/**
 * Quest objective, as a tool accepts one.
 *
 * The three writable fields of the column's element. `waivedReason` /
 * `waivedBy` / `waivedAt` are deliberately absent: waiving is part of
 * closing a quest, not a property anyone can set in passing, and
 * `quest_complete` is the only door to it.
 *
 * `id` stays optional so `quest_create` works with no ids at all, and so a
 * `quest_update` replace can mix kept objectives (carrying their id) with
 * brand-new ones (carrying none).
 */
export const objectiveInputSchema = quests.schema.shape.objectives.element
  .pick({ id: true, title: true, completed: true })
  .extend({
    id: z
      .integer()
      .min(0)
      .describe(
        "The id this objective already has, from `quest_get`. Carry it and the objective keeps its identity (and the history rows pointing at it stay true); omit it and a fresh objective is created. Omit on every item when creating a quest.",
      )
      .optional(),
  });
