import { type Infer, z } from "alepha";

/**
 * The switches inside the Support capability. There are none yet.
 *
 * Declared as an empty object rather than left out, so every capability
 * answers the same shape and no reader has to special-case the one that has
 * nothing: `CapabilityRegistry.optionsOf("support")` returns `{}` the way the
 * others return their defaults.
 *
 * ⚠️ **"A public request page" is the obvious first one and is deliberately
 * not here.** `/:projectSlug/request` is a public URL some owners will not
 * want, so the switch is real and worth having - but it does not exist, and
 * adding a feature to fill a slot in a wizard is the wrong order.
 *
 * See {@link workCapabilityOptionsSchema} for why this schema is lax rather
 * than closed.
 */
export const supportCapabilityOptionsSchema = z.object({});

export type SupportCapabilityOptions = Infer<
  typeof supportCapabilityOptionsSchema
>;
