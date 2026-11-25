import { $atom, z } from "alepha";

/**
 * The Feedback page's list pane width (#Q4325), set by dragging its right
 * edge. A cookie, as `questLogCollapsedAtom` is, so the page renders at the
 * chosen width from its first server paint. Global, not per project: how
 * wide a person likes the list is about them, not about one project.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const feedbackListWidthAtom = $atom({
  name: "lor.feedback.list-width",
  schema: z.object({
    /**
     * In pixels. Absent means the default width.
     */
    width: z.integer().optional(),
  }),
  default: {},
  persist: "cookie",
});
