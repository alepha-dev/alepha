import { $atom, t } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const userCampaignsAtom = $atom({
  name: "lor.user.campaigns",
  schema: t.optional(t.array(campaigns.schema)),
});
