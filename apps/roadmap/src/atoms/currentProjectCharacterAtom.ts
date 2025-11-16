import { $atom, t } from "alepha";
import { characters } from "../entities/characters.ts";

export const currentProjectCharacterAtom = $atom({
  name: "current_project_character",
  schema: t.optional(characters.schema),
});
