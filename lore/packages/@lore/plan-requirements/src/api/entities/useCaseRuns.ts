import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { runBySchema } from "../schemas/runBySchema.ts";
import { runEvidenceSchema } from "../schemas/runEvidenceSchema.ts";
import { useCases } from "./useCases.ts";

/**
 * A run of a use case (#E153): who played it, where (an app copy's `app`
 * and `env`, or `local`), when, the scenario version it ran, and its
 * evidence. Its results are `use_case_run_results`, one per criterion.
 */
export const useCaseRuns = $entity({
  name: "use_case_runs",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    useCaseId: db.ref(z.integer(), () => useCases.cols.id, {
      onDelete: "cascade",
    }),
    by: db.default(runBySchema.meta({ mode: "text" }), "agent"),
    /**
     * The agent's or the CI's name for itself: `claude-code`, `github`.
     */
    client: z.string().max(60).optional(),
    byUserId: z.string().max(64).optional(),
    app: z.string().max(120).optional(),
    env: z.string().max(120).optional(),
    ranAt: z.datetime(),
    scenarioVersion: z.integer().min(1),
    note: z.string().max(4000).optional(),
    evidence: db.default(z.array(runEvidenceSchema), []),
  }),
  indexes: [
    { columns: ["useCaseId", "ranAt"] },
    { columns: ["projectId", "ranAt"] },
  ],
});

export type UseCaseRun = Infer<typeof useCaseRuns.schema>;
