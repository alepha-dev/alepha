import { type Infer, z } from "alepha";

/**
 * The four prompts a project can hand to an agent, one per surface and
 * verb: Review and Activate on an epic, Work on it on a quest, and Work on
 * it on a feedback item.
 *
 * The literals ARE the stored values: `project_prompts.kind` is the primary
 * key beside `projectId`, and a row's absence means "use the built-in
 * default". So renaming one silently orphans a customised template rather
 * than failing, which is why the four spellings are pinned here and
 * imported everywhere rather than restated.
 *
 * Kept in `api/schemas` because both halves need it: the entity types the
 * column with it and the controller validates a path param against it,
 * while the web's `agentPromptDefaults` maps it to a template.
 */
export const agentPromptKindSchema = z.enum([
  "epicReview",
  "epicActivate",
  "questWork",
  "feedbackWork",
]);

export type AgentPromptKind = Infer<typeof agentPromptKindSchema>;
