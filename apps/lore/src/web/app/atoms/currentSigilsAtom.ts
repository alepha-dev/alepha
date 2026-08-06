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
 * differently: `[]` is "this project has no apps yet", `undefined` is "the list
 * could not be read". The loader catches a failed `listSigils` so a member
 * whose read fails still gets a working page, and telling them the project is
 * empty would be a lie with a plausible-looking call to action attached.
 */
export const currentSigilsAtom = $atom({
  name: "lor.current.sigils",
  schema: z.array(sigilResourceSchema).optional(),
});
