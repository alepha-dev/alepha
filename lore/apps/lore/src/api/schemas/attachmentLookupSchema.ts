import { z } from "alepha";

/**
 * Row shape of the "which project owns the row that lists this file?" probe
 * in `LoreFileAccessProvider`.
 *
 * Two columns, because that is all the access gate needs: the id it matched
 * and the project it hangs off. Both `feedback` and `quests` are queried
 * through it, so widening it costs a read on every attachment download.
 */
export const attachmentLookupSchema = z.object({
  id: z.integer(),
  projectId: z.integer(),
});
