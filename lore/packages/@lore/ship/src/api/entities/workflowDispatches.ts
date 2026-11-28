import { projects, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * A workflow a member started from Lore (#Q4366, epic #E177): what was
 * asked (the workflow, the ref, the inputs) and by whom, then the run
 * GitHub started for it once its `workflow_run` delivery names it.
 *
 * GitHub's dispatch answers 204 with no run id, so the run is matched
 * afterwards: the first `workflow_dispatch` run of that workflow, on that
 * ref, created after the request, that no other dispatch holds. A request
 * that never gets a run (the workflow failed to start) keeps no `runId`.
 */
export const workflowDispatches = $entity({
  name: "workflow_dispatches",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    workflowId: z.integer(),
    workflowName: z.string().min(1).max(200),
    ref: z.string().min(1).max(255),
    inputs: z.record(z.string(), z.string().max(1_000)).optional(),
    requestedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    requestedAt: z.string(),
    runId: z.integer().optional(),
    runUrl: z.string().max(500).optional(),
    runStatus: z.string().max(20).optional(),
    runConclusion: z.string().max(20).optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId", "requestedAt"] },
    { columns: ["projectId", "runId"] },
  ],
});

export type WorkflowDispatchRow = Infer<typeof workflowDispatches.schema>;
