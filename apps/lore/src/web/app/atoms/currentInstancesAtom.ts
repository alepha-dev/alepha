import { $atom, z } from "alepha";

import { appInstanceResourceSchema } from "@/api/schemas/appInstanceResourceSchema.ts";

/**
 * Every deployed copy of every app in the current project — what the Apps list
 * renders, what the create dialog's combobox reads its existing names from, and
 * what Spotlight appends its instances from.
 *
 * Filled by the `project` route loader and cleared on leave, like the other
 * `current*` atoms.
 *
 * ⚠️ **`[]` and `undefined` mean different things, and the rename from
 * `currentSigilsAtom` kept that on purpose.** `[]` is "this project has no
 * instances yet"; `undefined` is "the list could not be read", and the two
 * render differently everywhere they are read, because saying nothing is empty
 * when it might not be is a different claim than saying it is. A falsy check
 * that flattens them claims a project has no apps on the strength of a
 * transient failure. The loader catches a failed `listApps` so a member whose
 * read fails still gets a working page.
 */
export const currentInstancesAtom = $atom({
  name: "lor.current.instances",
  schema: z.array(appInstanceResourceSchema).optional(),
});
