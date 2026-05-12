import { $atom, t } from "alepha";

export const folioTagsAtom = $atom({
  name: "lor.folio.tags",
  schema: t.array(t.string()),
  default: [],
});
