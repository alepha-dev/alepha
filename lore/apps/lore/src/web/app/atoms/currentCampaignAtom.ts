import { $atom, t } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const currentCampaignAtom = $atom({
  name: "lor.current.campaign",
  schema: t.optional(
    t.extend(campaigns.schema, {
      // Set by the campaign route loader from `getCampaignById`. Drives the
      // Roster sidebar entry — visible only when there are ≥2 characters.
      // Optional because other writers (e.g. `updateCampaignById`) reset the
      // atom with a plain Campaign — the sidebar check tolerates undefined.
      characterCount: t.optional(t.integer()),
    }),
  ),
});
