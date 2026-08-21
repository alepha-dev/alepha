import { $atom, z } from "alepha";

import { sigilResourceSchema } from "@/api/schemas/sigilResourceSchema.ts";

/**
 * Every app enrolled in the current project — what the sidebar's Apps section
 * lists.
 *
 * Filled by the `project` route loader and cleared on leave, like the other
 * `current*` atoms.
 *
 * `[]` and `undefined` mean different things and the sidebar renders each
 * differently: `[]` is "this project has no apps yet" and hides the Apps
 * section entirely (enrolling lives on the settings page, not the sidebar);
 * `undefined` is "the list could not be read" and renders a "Couldn't load
 * apps" entry instead, because saying nothing is empty when it might not be
 * is a different claim than saying it is. The loader catches a failed
 * `listSigils` so a member whose read fails still gets a working page.
 */
export const currentSigilsAtom = $atom({
  name: "lor.current.sigils",
  schema: z.array(sigilResourceSchema).optional(),
});
