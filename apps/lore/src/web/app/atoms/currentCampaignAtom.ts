import { $atom, z } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const currentCampaignAtom = $atom({
  name: "lor.current.campaign",
  schema: campaigns.schema
    .extend({
      // Set by the campaign route loader from `getCampaignById`. Optional
      // because other writers (e.g. `updateCampaignById`) reset the atom
      // with a plain Campaign — readers tolerate undefined.
      memberCount: z.integer().optional(),
    })
    .optional(),
});
