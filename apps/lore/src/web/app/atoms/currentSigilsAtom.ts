import { $atom, z } from "alepha";
import { sigilResourceSchema } from "@/api/schemas/sigilResourceSchema.ts";

/**
 * Every app enrolled in the current project — what the sidebar's Apps section
 * lists.
 *
 * Filled by the `project` route loader and cleared on leave, like the other
 * `current*` atoms. Empty (not undefined) when the project has no apps or when
 * the list could not be read: the sidebar must render either way.
 */
export const currentSigilsAtom = $atom({
  name: "lor.current.sigils",
  schema: z.array(sigilResourceSchema),
  default: [],
});
