import { z } from "alepha";

/**
 * Exact branch identity, shared by dashboard and automation reads.
 */
export const qualityNumericFiltersSchema = z.object({
  branch: z.string().min(1).max(200).default("main"),
});
