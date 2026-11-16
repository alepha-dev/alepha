import { type Infer, z } from "alepha";

/**
 * How much a use case matters (#E153). Stored as text, so a value added later is a code-only change.
 */
export const useCasePrioritySchema = z.enum(["low", "medium", "high"]);

export type UseCasePriority = Infer<typeof useCasePrioritySchema>;
