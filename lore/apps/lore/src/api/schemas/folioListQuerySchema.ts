import { z } from "alepha";

/**
 * Query accepted by the folio list: a page window, a free-text needle, the
 * mandatory project scope, and the optional epic narrowing.
 */
export const folioListQuerySchema = z.object({
  limit: z.integer().min(1).max(100).default(50).optional(),
  offset: z.integer().min(0).default(0).optional(),
  q: z.string().optional(),
  projectId: z.integer(),
  /**
   * Narrow to the folios attached to one epic. Added for the Epic detail
   * page (`ProjectEpicFolios.tsx`) — filtering server-side means an epic
   * with an attached folio outside the page's own `limit` window never
   * silently drops it, the way a client-side filter over a capped,
   * unrelated-order page would.
   */
  epicId: z.integer().optional(),
});
