import type { Infer } from "alepha";

import { projectErrors } from "../entities/projectErrors.ts";

/**
 * An error row as exposed to a project member — the whole entity minus its
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
export const projectErrorResourceSchema = projectErrors.schema.omit({
  projectId: true,
});

export type ProjectErrorResource = Infer<typeof projectErrorResourceSchema>;
