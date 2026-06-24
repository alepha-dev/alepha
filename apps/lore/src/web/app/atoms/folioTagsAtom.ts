import { $atom, z } from "alepha";

export const folioTagsAtom = $atom({
  name: "lor.folio.tags",
  schema: z.array(z.string()),
  default: [],
});
