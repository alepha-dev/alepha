import { type Infer, z } from "alepha";

import { useCaseRunResults } from "../entities/useCaseRunResults.ts";
import { useCaseRuns } from "../entities/useCaseRuns.ts";

/**
 * A run with its results (#E153).
 */
export const useCaseRunResourceSchema = useCaseRuns.schema.extend({
  results: z.array(
    useCaseRunResults.schema.pick({
      criterionKey: true,
      result: true,
      note: true,
    }),
  ),
});

export type UseCaseRunResource = Infer<typeof useCaseRunResourceSchema>;
