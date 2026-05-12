import { $atom, t } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const currentCampaignAtom = $atom({
  name: "lor.current.campaign",
  schema: t.optional(campaigns.schema),
});
