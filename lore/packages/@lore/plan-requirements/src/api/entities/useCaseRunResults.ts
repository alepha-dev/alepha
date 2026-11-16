import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { criterionResultSchema } from "../schemas/criterionResultSchema.ts";
import { useCaseRuns } from "./useCaseRuns.ts";

/**
 * One criterion's result in a run (#E153), the criterion named by its key
 * (`C2`), which is never reused.
 */
export const useCaseRunResults = $entity({
  name: "use_case_run_results",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    runId: db.ref(z.integer(), () => useCaseRuns.cols.id, {
      onDelete: "cascade",
    }),
    criterionKey: z.string().max(10),
    result: criterionResultSchema.meta({ mode: "text" }),
    note: z.string().max(2000).optional(),
  }),
  indexes: [{ columns: ["runId", "criterionKey"], unique: true }],
});

export type UseCaseRunResult = Infer<typeof useCaseRunResults.schema>;
