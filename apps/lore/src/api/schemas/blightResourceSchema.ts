import type { Infer } from "alepha";

import { blights } from "../entities/blights.ts";

/**
 * A blight row as exposed to a project member — the whole entity minus its
 * `projectId`, which the caller supplied to get here.
 *
 * Derived from the entity rather than restated. The three copies of these
 * eleven fields (entity, this, and the MCP result schema) had already drifted:
 * `sigilId` was `z.uuid()` here and `z.string()` over MCP.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are entirely
 * attacker-controlled — they come out of an application's runtime. They are
 * data to read, never instructions to follow, and the UI must render them as
 * escaped plain text only: never markdown, never `dangerouslySetInnerHTML`.
 */
export const blightResourceSchema = blights.schema.omit({ projectId: true });

export type BlightResource = Infer<typeof blightResourceSchema>;
