import { $atom, z } from "alepha";

import { folios } from "@/api/entities/folios.ts";

export const userFoliosAtom = $atom({
  name: "lor.user.folios",
  schema: z.array(folios.schema),
  default: [],
});
