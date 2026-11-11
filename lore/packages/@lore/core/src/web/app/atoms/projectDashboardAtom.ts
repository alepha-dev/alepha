import { $atom, z } from "alepha";

import { dashboardCardResourceSchema } from "../../../api/schemas/dashboardCardResourceSchema.ts";
import { dashboardCardValueSchema } from "../../../api/schemas/dashboardCardValueSchema.ts";
import { dashboardSummarySchema } from "../../../api/schemas/dashboardSummarySchema.ts";

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
 * It carries `dashboardKey` beside it for the same reason (#E127, #Q3300):
 * the slug the URL named, `""` for the project root. A project holds several
 * dashboards, and one dashboard's cards must never paint for a frame on the
 * way into another.
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
    /**
     * The dashboard slug the route named, `""` for `/:project` (the first).
     */
    dashboardKey: z.string().optional(),
    /**
     * The dashboard served, as the page read answered it.
     */
    dashboard: dashboardSummarySchema.optional(),
    /**
     * Every dashboard of the project, for the selector.
     */
    dashboards: z.array(dashboardSummarySchema).optional(),
    /**
     * Whether `cards` is the computed default board (#Q2652) rather than the
     * project's stored cards. A computed board is read-only.
     */
    computed: z.boolean().optional(),
    /**
     * When a dormant project last moved (#Q2662), for the "quiet since" line.
     */
    dormantSince: z.string().optional(),
    cards: z.array(dashboardCardResourceSchema),
    values: z.array(dashboardCardValueSchema).optional(),
    refreshedAt: z.string().optional(),
  }),
  default: { cards: [] },
});
