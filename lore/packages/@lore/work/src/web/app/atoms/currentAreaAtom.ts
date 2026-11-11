import { $atom } from "alepha";

import { areaResourceSchema } from "../../../api/schemas/areaResourceSchema.ts";

/**
 * The area whose settings page is open, set by the `projectSettingsArea`
 * route loader and cleared on leave.
 *
 * It exists for the breadcrumb (#Q3408), rendered by `ProjectView` above
 * this route, which sees only `areaId`: the name has to be handed up, as
 * `currentEpicAtom` hands up an epic's number.
 */
export const currentAreaAtom = $atom({
  name: "lor.current.area",
  schema: areaResourceSchema.optional(),
});
