import { type Infer, z } from "alepha";

/**
 * The switches inside the Prompts capability (#E175): none.
 *
 * Lax rather than closed, like every capability's options schema: a stored
 * row read by a build with one option fewer strips the extra key.
 */
export const promptsCapabilityOptionsSchema = z.object({});

export type PromptsCapabilityOptions = Infer<
  typeof promptsCapabilityOptionsSchema
>;
