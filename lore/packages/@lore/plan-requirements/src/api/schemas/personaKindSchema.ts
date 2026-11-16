import { type Infer, z } from "alepha";

/**
 * What kind of actor a persona is (#E153): a person, another system, or an
 * agent. Stored as text, so a kind added later is a code-only change.
 */
export const personaKindSchema = z.enum(["human", "system", "agent"]);

export type PersonaKind = Infer<typeof personaKindSchema>;
