import { $atom, z } from "alepha";

/**
 * Number of `draft` epics for the current project.
 *
 * Set by the `project` route loader (one fetch per project navigation,
 * mirrors `currentErrorCountAtom`) and read by the sidebar to show a badge
 * next to the Epics entry. Reset to `{ count: 0 }` on project leave.
 *
 * The badge says, from the sidebar, that plans are still being written:
 * `countOpenQuests` leaves drafts out, so the Quests badge never counts a
 * draft epic's quests, which are listed under the Status filter's Draft,
 * on the epic's page and in the board's Draft column (#E178).
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
