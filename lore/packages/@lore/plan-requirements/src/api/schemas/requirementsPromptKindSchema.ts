import { type Infer, z } from "alepha";

/**
 * The prompt kinds of Plan's Requirements (#E153), rendered on the server
 * from their defaults.
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
