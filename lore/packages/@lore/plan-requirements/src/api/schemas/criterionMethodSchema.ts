import { type Infer, z } from "alepha";

/**
 * How an acceptance criterion is verified (#E153): an end-to-end spec, an agent, or a person. Stored as text, so a value added later is a code-only change.
 */
export const criterionMethodSchema = z.enum(["e2e", "agent", "manual"]);

export type CriterionMethod = Infer<typeof criterionMethodSchema>;
