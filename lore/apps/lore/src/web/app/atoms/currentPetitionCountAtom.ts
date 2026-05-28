import { $atom, t } from "alepha";

/**
 * Number of `pending` (un-triaged) petitions for the current campaign.
 *
 * Updated by `CampaignView` via a lightweight poll against `petitionApi.list`
 * — read by the tab nav to show a badge next to the Petitions tab. Reset to
 * `{ count: 0 }` on campaign leave (errors during polling are silently
 * ignored).
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentPetitionCountAtom = $atom({
  name: "lor.current.petition_count",
  schema: t.object({
    count: t.integer(),
  }),
  default: { count: 0 },
});
