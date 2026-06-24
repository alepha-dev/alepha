import { $atom, z } from "alepha";
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
  schema: z
    .object({
      campaigns: z.array(campaigns.schema),
      totalCount: z.integer(),
      ownedCount: z.integer(),
      maxCampaigns: z.integer(),
      canCreate: z.boolean(),
    })
    .optional(),
});
