import { type Infer } from "alepha";

import { personas } from "../entities/personas.ts";

/**
 * A persona as every surface reads it (#E153): the row without its
 * soft-delete stamp.
 */
export const personaResourceSchema = personas.schema.omit({ deletedAt: true });

export type PersonaResource = Infer<typeof personaResourceSchema>;
