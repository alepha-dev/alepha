import { $atom, t } from "alepha";
import { folioResourceSchema } from "@/api/schemas/folioResourceSchema.ts";

export const currentFolioAtom = $atom({
  name: "lor.current.folio",
  schema: t.optional(folioResourceSchema),
});
