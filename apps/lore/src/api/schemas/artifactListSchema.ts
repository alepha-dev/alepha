import { type Infer, z } from "alepha";

import { artifactGroupSchema } from "./artifactGroupSchema.ts";

/**
 * What a listing answers: the groups, and whether it is the whole story.
 *
 * ## ⚠️ Why `truncated` and not an offset
 *
 * The rows are grouped after they are read, so an offset would page over ROWS
 * while the caller reads GROUPS - and a page boundary landing between two
 * variants of one tag would show `1.2.3` twice, once per page, each claiming
 * to be the whole release. That is exactly the reading this shape exists to
 * prevent.
 *
 * A cap plus an honest flag is the smaller promise, and it fits what a project
 * actually holds: `latest` is replaced in place rather than accumulating, so
 * the count is the pinned tags somebody chose to keep. A listing that silently
 * stopped would be the real failure, which is what this field is for.
 */
export const artifactListSchema = z.object({
  groups: z.array(artifactGroupSchema),
  /**
   * True when the query hit the row cap, so more artifacts exist than are
   * listed here. Narrow with `app` or `tag` to see them.
   */
  truncated: z.boolean(),
});

export type ArtifactList = Infer<typeof artifactListSchema>;
