import { type Infer, z } from "alepha";

/**
 * The `releasesToPublish` dashboard metric's filters (#Q2654): none.
 */
export const releasesToPublishFiltersSchema = z.object({});

export type ReleasesToPublishFilters = Infer<
  typeof releasesToPublishFiltersSchema
>;
