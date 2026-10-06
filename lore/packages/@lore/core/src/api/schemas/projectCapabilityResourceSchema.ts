import type { Infer } from "alepha";

import { projectCapabilities } from "../entities/projectCapabilities.ts";

/**
 * One enabled capability, as the API hands it out.
 *
 * `pick` from the entity rather than a restatement: a field is declared once,
 * on the entity, and everything else reaches it. `id` and `projectId` are left
 * out because the entry only ever appears inside the project that owns it.
 *
 * ⚠️ **The array carries only enabled capabilities.** Absence is disabled,
 * both on disk and here, so a client asks "is this key present" and never
 * reads a flag. There is deliberately no `enabled: false` entry for a reader
 * to get the wrong way round.
 *
 * ⚠️ **`options` arrives with its defaults filled in** by
 * `CapabilityRegistry.optionsOf`, so every option a capability declares is
 * present as a boolean and the client never applies a fallback of its own.
 * That is what stops "absent reads as false" from having to be re-implemented
 * in the browser, where getting it backwards turns a switch on for everybody.
 */
export const projectCapabilityResourceSchema = projectCapabilities.schema.pick({
  key: true,
  enabledAt: true,
  options: true,
});

export type ProjectCapabilityResource = Infer<
  typeof projectCapabilityResourceSchema
>;
