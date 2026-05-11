import { $atom, t } from "alepha";

/**
 * Number of `new` (un-triaged) beacons for the current campaign.
 *
 * Updated by `CampaignView` via a lightweight poll against `beaconApi.list`
 * — read by the tab nav to show a badge next to the Beacons tab. Reset to
 * `{ count: 0 }` on campaign leave (errors during polling are silently
 * ignored so campaigns without beacons enabled don't surface a stale count).
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentBeaconCountAtom = $atom({
  name: "rdm.current.beacon_count",
  schema: t.object({
    count: t.integer(),
  }),
  default: { count: 0 },
});
