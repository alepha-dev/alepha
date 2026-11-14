import { $atom, z } from "alepha";

/**
 * Number of `open` (un-triaged) errors for the current project.
 *
 * Set by the `project` route loader (one fetch per project navigation,
 * mirrors `currentFeedbackCountAtom`) and read by the sidebar to show a
 * badge next to the Errors entry. The Errors inbox page also refreshes
 * it on resolve / forward / delete so within-session math stays correct.
 * Reset to `{ count: 0 }` on project leave.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentErrorCountAtom = $atom({
  name: "lor.current.error_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
