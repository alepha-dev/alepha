import { $atom, z } from "alepha";

import { dashboardCardResourceSchema } from "@/api/schemas/dashboardCardResourceSchema.ts";
import { dashboardCardValueSchema } from "@/api/schemas/dashboardCardValueSchema.ts";

/**
 * The signed-in landing page's cards, and what they resolved to.
 *
 * Two halves in one atom because they are read together on every render and
 * written at different times: the `home` route loader fills `cards` (small,
 * no metric work, so the grid can lay out immediately), and the page resolves
 * the values once on mount. That is what makes "loading" a designed state
 * rather than a blank page — the tiles, their titles and their chips are all
 * on screen before a single number arrives.
 *
 * ⚠️ **Nothing polls.** `refreshedAt` is a timestamp on an explicit refresh.
 * Ten auto-refreshing tiles on the landing page is the exact shape of the
 * QuestGraph incident (folio #1057): 4,009 identical `/api/_batch` requests
 * from one browser tab in 51 minutes, roughly 35% of that day's account-wide
 * Worker invocations.
 *
 * `values: undefined` means "not resolved yet" and renders skeletons; `[]`
 * means "resolved, and there are no cards".
 */
export const dashboardAtom = $atom({
  name: "lor.dashboard",
  schema: z.object({
    cards: z.array(dashboardCardResourceSchema),
    values: z.array(dashboardCardValueSchema).optional(),
    refreshedAt: z.string().optional(),
  }),
  default: { cards: [] },
});
