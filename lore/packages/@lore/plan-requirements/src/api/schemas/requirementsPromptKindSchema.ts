import { type Infer, z } from "alepha";

/**
 * The prompt kinds of Plan's Requirements (#E153), a subset of core's
 * `agentPromptKindSchema`, rendered on the server.
 */
export const requirementsPromptKindSchema = z.enum([
  "useCaseTest",
  "useCaseSpec",
  "useCaseDemo",
  "personaExplore",
  "requirementImport",
  "useCaseDraft",
]);

export type RequirementsPromptKind = Infer<typeof requirementsPromptKindSchema>;
