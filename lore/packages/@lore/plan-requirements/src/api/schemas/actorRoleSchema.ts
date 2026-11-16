import { type Infer, z } from "alepha";

/**
 * What a persona does in a use case (#E153): leads it, benefits from it, or is a system it calls. Stored as text, so a value added later is a code-only change.
 */
export const actorRoleSchema = z.enum(["primary", "beneficiary", "system"]);

export type ActorRole = Infer<typeof actorRoleSchema>;
