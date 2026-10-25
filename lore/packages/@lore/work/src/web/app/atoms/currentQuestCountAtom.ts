import { $atom, z } from "alepha";

/**
 * Number of open (not completed) quests for the current project.
 *
 * Set by the `project` route loader, read by the sidebar. Mirrors
 * `currentBlightCountAtom` and `currentFeedbackCountAtom` — all three count
 * work that still needs attention, which is what makes the number worth a
 * glance. Reset to `{ count: 0 }` on project leave.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentQuestCountAtom = $atom({
  name: "lor.current.quest_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
