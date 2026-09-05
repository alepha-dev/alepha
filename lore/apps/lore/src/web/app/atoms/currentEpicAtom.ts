import { $atom } from "alepha";

import { epicResourceSchema } from "@/api/schemas/epicResourceSchema.ts";

/**
 * The epic whose page is open — set by the `projectEpic` route loader,
 * cleared on leave.
 *
 * It exists for the breadcrumb, which is rendered by `ProjectView` — the
 * layout ABOVE this route. The layout can only see the route's params
 * (`epicNumber`), and a number is not a title, so the leaf has to be handed
 * up rather than derived. Same arrangement, and same reason, as
 * `currentInstanceAtom` for the Apps pages.
 *
 * The loader is the only writer. `ProjectEpic` keeps its own copy in state
 * and replaces it on a status change, which the breadcrumb does not read —
 * if the epic title ever becomes editable in place, this atom has to be
 * written on that save too.
 */
export const currentEpicAtom = $atom({
  name: "lor.current.epic",
  schema: epicResourceSchema.optional(),
});
