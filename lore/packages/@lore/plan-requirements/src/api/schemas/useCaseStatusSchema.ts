import { type Infer, z } from "alepha";

/**
 * A use case's status (#E153): drafted, ready to verify, validated by a holder of usecase:validate, or deprecated. Stored as text, so a value added later is a code-only change.
 */
export const useCaseStatusSchema = z.enum([
  "draft",
  "ready",
  "validated",
  "deprecated",
]);

export type UseCaseStatus = Infer<typeof useCaseStatusSchema>;
