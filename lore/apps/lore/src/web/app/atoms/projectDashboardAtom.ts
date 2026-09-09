import { $atom, z } from "alepha";

import { dashboardCardResourceSchema } from "@/api/schemas/dashboardCardResourceSchema.ts";
import { dashboardCardValueSchema } from "@/api/schemas/dashboardCardValueSchema.ts";

/**
 * The open project's board, and what its cards resolved to.
 *
 * ⚠️ **Its own atom, not `dashboardAtom`.** That one is a global singleton
 * named `lor.dashboard` holding home's cards; reusing it would leak the home
 * board's tiles into a project and back out again across a navigation.
 *
 * It carries `projectId` for the same reason `kanbanFiltersAtom` does: an atom
 * that outlives one project's page would otherwise show the previous
 * project's cards for a frame, and a card list is not a thing to guess at.
 * A reader whose `projectId` does not match the route treats the atom as
 * empty.
 *
 * ⚠️ **Nothing polls.** `refreshedAt` is a timestamp on an explicit resolve.
 * Ten auto-refreshing tiles is the exact shape of the QuestGraph incident
 * (folio #1057): 4,009 identical `/api/_batch` requests from one browser tab
 * in 51 minutes.
 *
 * `values: undefined` means "not resolved yet" and renders skeletons; `[]`
 * means "resolved, and there are no cards".
 */
export const projectDashboardAtom = $atom({
  name: "lor.project.dashboard",
  schema: z.object({
    projectId: z.integer().optional(),
    cards: z.array(dashboardCardResourceSchema),
    values: z.array(dashboardCardValueSchema).optional(),
    refreshedAt: z.string().optional(),
  }),
  default: { cards: [] },
});
