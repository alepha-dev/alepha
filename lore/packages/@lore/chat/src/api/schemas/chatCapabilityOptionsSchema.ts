import { type Infer, z } from "alepha";

/**
 * The switches inside the Chat capability (#E161): none in V1.
 *
 * Lax rather than closed, like every capability's options schema: a stored
 * row read by a build with one option fewer strips the extra key.
 */
export const chatCapabilityOptionsSchema = z.object({});

export type ChatCapabilityOptions = Infer<typeof chatCapabilityOptionsSchema>;
