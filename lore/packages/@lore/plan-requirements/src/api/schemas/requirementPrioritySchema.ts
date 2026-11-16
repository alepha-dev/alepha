import { type Infer, z } from "alepha";

/**
 * A requirement's MoSCoW priority (#E153). Stored as text where it is stored, so a value added later is a
 * code-only change.
 */
export const requirementPrioritySchema = z.enum([
  "must",
  "should",
  "could",
  "wont",
]);

export type RequirementPriority = Infer<typeof requirementPrioritySchema>;
