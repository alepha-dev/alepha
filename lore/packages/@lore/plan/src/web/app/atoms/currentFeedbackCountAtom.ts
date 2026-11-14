import { $atom, z } from "alepha";

/**
 * Number of `pending` (un-triaged) feedback for the current project.
 *
 * Written by the `project` route loader and by `ProjectFeedback` after a
 * triage; read by the sidebar to show a badge next to the Feedback entry.
 * Cleared on project leave.
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
