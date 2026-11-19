import { type Infer, z } from "alepha";

/**
 * The switches inside the Build capability: none yet. Build holds git
 * repositories and Quality, and neither has an option to turn.
 *
 * See {@link planCapabilityOptionsSchema} for why this schema is lax rather
 * than closed.
 */
export const buildCapabilityOptionsSchema = z.object({});

export type BuildCapabilityOptions = Infer<typeof buildCapabilityOptionsSchema>;
