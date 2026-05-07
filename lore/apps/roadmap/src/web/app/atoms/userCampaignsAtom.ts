import { $atom, t } from "alepha";
import { campaigns } from "@/api/entities/campaigns.ts";

export const userCampaignsAtom = $atom({
  name: "rdm.user.campaigns",
  schema: t.optional(t.array(campaigns.schema)),
});
