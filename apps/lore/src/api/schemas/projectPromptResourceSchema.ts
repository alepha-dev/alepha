import { type Infer } from "alepha";

import { projectPrompts } from "../entities/projectPrompts.ts";

/**
 * One customised agent prompt, as the client sees it.
 *
 * `kind` and `template` and nothing else: the id, the project id and the two
 * stamps are the row's own bookkeeping, and the client addresses a prompt by
 * its kind. Picked from the entity rather than restated, so the 20 000
 * character bound is declared once.
 */
export const projectPromptResourceSchema = projectPrompts.schema.pick({
  kind: true,
  template: true,
});

export type ProjectPromptResource = Infer<typeof projectPromptResourceSchema>;
