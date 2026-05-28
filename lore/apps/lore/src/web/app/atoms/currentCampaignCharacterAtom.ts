import { $atom, t } from "alepha";
import { characters } from "@/api/entities/characters.ts";

export const currentCampaignCharacterAtom = $atom({
  name: "lor.current.campaign_character",
  schema: t.optional(characters.schema),
});
