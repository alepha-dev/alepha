import { $atom } from "alepha";

import { requirementResourceSchema } from "../../../api/schemas/requirementResourceSchema.ts";

/**
 * The requirement whose page is open (#E153), set by its route's loader: the
 * breadcrumb leaf lives in `ProjectView`, above the page, and reads it here.
 */
export const currentRequirementAtom = $atom({
  name: "lor.current.requirement",
  schema: requirementResourceSchema.optional(),
});
