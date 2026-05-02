import { $atom, t } from "alepha";
import { folios } from "@/api/entities/folios.ts";

export const userFoliosAtom = $atom({
  name: "rdm.user.folios",
  schema: t.array(folios.schema),
  default: [],
});
