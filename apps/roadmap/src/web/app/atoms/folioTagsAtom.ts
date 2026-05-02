import { $atom, t } from "alepha";

export const folioTagsAtom = $atom({
  name: "rdm.folio.tags",
  schema: t.array(t.string()),
  default: [],
});
