import { $atom, z } from "alepha";

/**
 * The leaf a project page names for itself once its own read has answered
 * (#Q3408): an automation's title, a run's status, a drill-down's dimension.
 *
 * Written by `usePageCrumb`, read by `ProjectTrail`, which appends it when
 * `routeName` is the page open. Keyed by route rather than cleared on time,
 * so a leaf left by the page before never reaches the next one's trail. A
 * page whose leaf its loader already knows hands it up through its own atom
 * and a crumb contribution instead, as the host and the area do.
 */
export const pageCrumbAtom = $atom({
  name: "lor.page.crumb",
  schema: z
    .object({
      routeName: z.string(),
      label: z.string(),
    })
    .optional(),
});
