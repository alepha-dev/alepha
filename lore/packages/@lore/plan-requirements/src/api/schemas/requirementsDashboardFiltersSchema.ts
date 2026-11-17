import { type Infer, z } from "alepha";

/**
 * The Requirements cards take no filter (#E153, #Q3775): their scope (a
 * project, or one of its releases) is the whole question.
 */
export const requirementsDashboardFiltersSchema = z.object({});

export type RequirementsDashboardFilters = Infer<
  typeof requirementsDashboardFiltersSchema
>;
