import { $atom, z } from "alepha";

/**
 * The folio document's face the reader last chose (#Q3653): Edit, View or
 * Both, remembered across folios and reloads.
 *
 * `persist: "cookie"` for `folioTextSizeAtom`'s reason: the folio route is
 * server-rendered, and a cookie is read while rendering, so the first paint
 * is already the reader's choice. Absent until they pick one, which keeps
 * the old default: a folio with content opens in View, an empty one in
 * Edit. A value is a display mode, never trust-bearing; one out of range
 * fails the schema and falls back.
 */
export const folioModeAtom = $atom({
  name: "lor.folio.mode",
  schema: z.object({
    mode: z.enum(["edit", "view", "both"]).optional(),
  }),
  default: {},
  persist: "cookie",
});
