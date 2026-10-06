import { $atom } from "alepha";

import { homeBoardSchema } from "../../../api/schemas/homeBoardSchema.ts";

/**
 * Home's board (bars, last activity, open counts) as the `home` route loader
 * read it, so a signed-in visitor gets it in the FIRST paint and in the SSR
 * HTML, instead of the rows painting alone and the rest popping in a second
 * later.
 *
 * `undefined` when the loader did not get it: an anonymous visitor, a board
 * that failed, or one slower than the loader's time budget. `HomeBoard` then
 * fetches it itself, which is exactly what it did before the loader read it.
 */
export const homeBoardAtom = $atom({
  name: "lor.home.board",
  schema: homeBoardSchema.optional(),
  default: undefined,
});
