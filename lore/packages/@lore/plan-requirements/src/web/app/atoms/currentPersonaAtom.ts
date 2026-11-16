import { $atom } from "alepha";

import { personaResourceSchema } from "../../../api/schemas/personaResourceSchema.ts";

/**
 * The persona whose page is open (#E153), set by its route's loader: the
 * breadcrumb leaf lives in `ProjectView`, above the page, and reads it here.
 */
export const currentPersonaAtom = $atom({
  name: "lor.current.persona",
  schema: personaResourceSchema.optional(),
});
