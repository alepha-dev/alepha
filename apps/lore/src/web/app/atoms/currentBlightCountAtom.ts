import { $atom, z } from "alepha";

/**
 * Number of `open` (un-triaged) blights for the current campaign.
 *
 * Set by the `campaign` route loader (one fetch per campaign navigation,
 * mirrors `currentPetitionCountAtom`) and read by the sidebar to show a
 * badge next to the Blights entry. The Blights inbox page also refreshes
 * it on resolve / forward / delete so within-session math stays correct.
 * Reset to `{ count: 0 }` on campaign leave.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentBlightCountAtom = $atom({
  name: "lor.current.blight_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
