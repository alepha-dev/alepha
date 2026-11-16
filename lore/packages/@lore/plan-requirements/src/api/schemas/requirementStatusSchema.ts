import { type Infer, z } from "alepha";

/**
 * A requirement's status, computed on read and never stored (#E153): from the latest results once runs exist, covered or not covered before. Stored as text where it is stored, so a value added later is a
 * code-only change.
 */
export const requirementStatusSchema = z.enum([
  "verified",
  "failing",
  "in_development",
  "covered",
  "not_covered",
]);

export type RequirementStatus = Infer<typeof requirementStatusSchema>;
