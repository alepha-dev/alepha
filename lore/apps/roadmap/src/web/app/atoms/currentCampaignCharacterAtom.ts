import { $atom, t } from "alepha";
import { characters } from "@/api/entities/characters.ts";

export const currentCampaignCharacterAtom = $atom({
  name: "rdm.current.campaign_character",
  schema: t.optional(characters.schema),
});
