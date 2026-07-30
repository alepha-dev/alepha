import { $atom } from "alepha";
import { members } from "@/api/entities/members.ts";

export const currentCampaignMemberAtom = $atom({
  name: "lor.current.campaign_member",
  schema: members.schema.optional(),
});
