import { type Infer, z } from "alepha";

/**
 * Where a use case stands from its latest run (#E153): never run, passed, failed with every covering quest done (Failing), or failed while quests are open (In development). Computed, never stored.
 */
export const useCaseRunStateSchema = z.enum([
  "never_run",
  "passed",
  "failed",
  "in_development",
]);

export type UseCaseRunState = Infer<typeof useCaseRunStateSchema>;
