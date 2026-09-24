import { $atom, z } from "alepha";

import { folioTreeEntrySchema } from "@/api/schemas/folioTreeEntrySchema.ts";

/**
 * The project's folios as the tree reads them: every one, without bodies
 * (see `FolioController.tree`, #Q2510). A full row written back after a save
 * fits too, since it only carries more.
 */
export const userFoliosAtom = $atom({
  name: "lor.user.folios",
  schema: z.array(folioTreeEntrySchema),
  default: [],
});
