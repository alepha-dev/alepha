import { type Infer, z } from "alepha";

/**
 * What kind of line of the specification a requirement is (#E153). Stored as text where it is stored, so a value added later is a
 * code-only change.
 */
export const requirementTypeSchema = z.enum([
  "functional",
  "non_functional",
  "constraint",
]);

export type RequirementType = Infer<typeof requirementTypeSchema>;
