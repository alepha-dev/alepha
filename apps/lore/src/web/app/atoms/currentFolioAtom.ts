import { $atom, t } from "alepha";
import { folios } from "@/api/entities/folios.ts";

export const currentFolioAtom = $atom({
  name: "lor.current.folio",
  schema: t.optional(folios.schema),
});
