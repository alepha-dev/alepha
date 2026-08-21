import { type Infer, z } from "alepha";

import { areas } from "../entities/areas.ts";

/**
 * Area + its server-computed rollup.
 *
 * `openQuestCount` is the number the UI leads with. `questCount` counts
 * everything ever filed here including completed and shelved quests —
 * with 420 of 434 quests closed in the Alepha project, a bare total is a
 * historical fact rather than a signal, which is exactly why the old
 * settings page read as noise.
 */
export const areaResourceSchema = areas.schema.extend({
  questCount: z.integer(),
  openQuestCount: z.integer(),
  firstQuestAt: z.string().optional(),
  lastQuestAt: z.string().optional(),
});

export type AreaResource = Infer<typeof areaResourceSchema>;

/**
 * The detail page's payload: the resource plus a sample of what is
 * actually filed here.
 *
 * The list exists so the person deciding whether to merge two areas can
 * see what is in them without leaving the page. Capped at 10 and sorted
 * newest-first — this is a glance, not a quest browser; the board is
 * where you browse.
 */
export const areaDetailSchema = areaResourceSchema.extend({
  recentQuests: z.array(
    z.object({
      shortId: z.integer(),
      title: z.string(),
      completedAt: z.string().optional(),
    }),
  ),
});

export type AreaDetail = Infer<typeof areaDetailSchema>;
