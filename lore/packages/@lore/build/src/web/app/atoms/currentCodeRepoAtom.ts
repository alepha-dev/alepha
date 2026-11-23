import { $atom } from "alepha";

import { codeRepositoryDetailSchema } from "../../../api/schemas/codeRepositoryDetailSchema.ts";

/**
 * The repository the code pages are under (#Q4133): set by the
 * `projectCodeRepo` loader, read by its tabs, cleared on leaving.
 */
export const currentCodeRepoAtom = $atom({
  name: "lor.current.codeRepo",
  schema: codeRepositoryDetailSchema.optional(),
});
