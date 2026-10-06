import { type Infer, z } from "alepha";

/**
 * The prompts a project can hand to an agent, one per surface and verb:
 * Review and Activate on an epic, Work on it on a quest, Work on it on a
 * feedback item, Triage the inbox on the feedback inbox, Triage the blights
 * on the blights inbox, and Work the loose quests on the Quests page.
 *
 * ⚠️ **Two shapes, not one.** The first four name ONE item and take an
 * `AgentPromptItemSubject`; `feedbackLoop`, `blightTriage` and `questLoop`
 * name a SURFACE and take an
 * `AgentPromptProjectSubject`, which has no `number`, `id`, `reference` or
 * `title` because a loop has no item to number. A template written for the
 * wrong shape does not fail - `renderPromptTemplate` leaves an unanswerable
 * placeholder verbatim - so the shape is a thing to check when adding a
 * kind, not something the compiler catches for you.
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
  "feedbackLoop",
  "blightTriage",
  "questLoop",
]);

export type AgentPromptKind = Infer<typeof agentPromptKindSchema>;
