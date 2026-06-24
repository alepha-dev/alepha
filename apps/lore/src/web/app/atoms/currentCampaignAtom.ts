import { $atom, z } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const currentCampaignAtom = $atom({
  name: "lor.current.campaign",
  schema: campaigns.schema
    .extend({
      // Set by the campaign route loader from `getCampaignById`. Drives the
      // Roster sidebar entry — visible only when there are ≥2 characters.
      // Optional because other writers (e.g. `updateCampaignById`) reset the
      // atom with a plain Campaign — the sidebar check tolerates undefined.
      characterCount: z.integer().optional(),
    })
    .optional(),
});
