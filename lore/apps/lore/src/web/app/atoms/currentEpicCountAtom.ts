import { $atom, z } from "alepha";

/**
 * Number of `planned` epics for the current project.
 *
 * Set by the `project` route loader (one fetch per project navigation,
 * mirrors `currentBlightCountAtom`) and read by the sidebar to show a badge
 * next to the Epics entry. Reset to `{ count: 0 }` on project leave.
 *
 * The badge exists because `countOpenQuests` applies the backlog gate:
 * quests inside a planned epic are deliberately left out of the Quests
 * count, so without this one the sidebar reported none of that work.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentEpicCountAtom = $atom({
  name: "lor.current.epic_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
