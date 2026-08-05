import { $atom, z } from "alepha";

/**
 * Number of `pending` (un-triaged) feedback for the current project.
 *
 * Updated by `ProjectView` via a lightweight poll against `feedbackApi.list`
 * — read by the tab nav to show a badge next to the Feedback tab. Reset to
 * `{ count: 0 }` on project leave (errors during polling are silently
 * ignored).
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentFeedbackCountAtom = $atom({
  name: "lor.current.feedback_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
