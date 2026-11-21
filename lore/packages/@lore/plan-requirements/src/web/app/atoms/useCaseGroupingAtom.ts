import { $atom, z } from "alepha";

/**
 * How the Use cases page groups its rows, per project (#Q3979): by persona
 * on a first visit, then the reader's last pick.
 *
 * `persist: "cookie"` rather than `localStorage`, as `questsViewAtom` is: the
 * page renders during SSR, where web storage does not exist, and a
 * localStorage atom would draw the default grouping for a frame first.
 * Keyed by project id, so one project's pick does not move another's.
 */
export const useCaseGroupingAtom = $atom({
  name: "lor.use-cases.grouping",
  schema: z.object({
    byProject: z.record(
      z.string(),
      z.enum(["epic", "persona", "status", "none"]),
    ),
  }),
  default: { byProject: {} },
  persist: "cookie",
});
