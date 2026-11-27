import { type Infer, z } from "alepha";

/**
 * The `recentDeployments` dashboard metric's filters (#Q4522): none. The
 * card's scope narrows it to copies.
 */
export const recentDeploymentsFiltersSchema = z.object({});

export type RecentDeploymentsFilters = Infer<
  typeof recentDeploymentsFiltersSchema
>;
