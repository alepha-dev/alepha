/**
 * The browser-safe schemas of `@lore/plan-requirements`, Plan's
 * Requirements (#E153).
 *
 * What another package, a browser page or an end-to-end spec may import as a
 * runtime value. Nothing here reaches a server-only module.
 *
 * @module
 */
export { personas } from "../api/entities/personas.ts";
export { requirementsComments } from "../api/entities/requirementsComments.ts";
export {
  type PersonaKind,
  personaKindSchema,
} from "../api/schemas/personaKindSchema.ts";
export {
  type PersonaResource,
  personaResourceSchema,
} from "../api/schemas/personaResourceSchema.ts";
export {
  type PersonaInput,
  personaInputSchema,
} from "../api/schemas/personaInputSchema.ts";
