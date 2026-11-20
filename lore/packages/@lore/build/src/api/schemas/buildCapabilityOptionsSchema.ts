import { type Infer, z } from "alepha";

/**
 * The switches inside the Build capability (#Q4005): `repositories`, git
 * hosting (the `code_*` actions, tools and git smart HTTP), and `quality`,
 * coverage (the Reports tab, its tiles and its event).
 *
 * See {@link planCapabilityOptionsSchema} for why this schema is lax rather
 * than closed.
 */
export const buildCapabilityOptionsSchema = z.object({
  repositories: z.boolean().default(false),
  quality: z.boolean().default(false),
});

export type BuildCapabilityOptions = Infer<typeof buildCapabilityOptionsSchema>;
