import { type Infer } from "alepha";

import { personas } from "../entities/personas.ts";

/**
 * What a create or an update writes on a persona (#E153): every field the
 * caller owns, each optional (an update leaves an omitted field alone; a
 * create requires `name`, checked by its own schema).
 */
export const personaInputSchema = personas.schema
  .pick({
    kind: true,
    name: true,
    role: true,
    who: true,
    goals: true,
    frustrations: true,
    alephaRole: true,
    demoAccount: true,
    demoSeed: true,
    environmentApp: true,
    environmentEnv: true,
    areas: true,
  })
  .partial();

export type PersonaInput = Infer<typeof personaInputSchema>;
