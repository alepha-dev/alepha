import { $atom, t } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

/**
 * Home/AppShell bootstrap data: the user's most-recent campaigns plus the
 * quota state needed to gate the "Create campaign" CTA.
 *
 * `campaigns` is a capped (top-N most recent), not the full list.
 * `totalCount` reflects the real number of memberships so the UI can show
 * "+N more". `canCreate` is server-derived against `maxCampaigns` to keep
 * client + server in agreement on the limit.
 */
export const userCampaignsAtom = $atom({
  name: "lor.user.campaigns",
  schema: t.optional(
    t.object({
      campaigns: t.array(campaigns.schema),
      totalCount: t.integer(),
      ownedCount: t.integer(),
      maxCampaigns: t.integer(),
      canCreate: t.boolean(),
    }),
  ),
});
