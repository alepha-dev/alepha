import { type Infer, z } from "alepha";

/**
 * One criterion's result in a run (#E153).
 */
export const criterionResultSchema = z.enum(["passed", "failed", "not_run"]);

export type CriterionResult = Infer<typeof criterionResultSchema>;
