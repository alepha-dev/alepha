import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { stackEnvironments } from "./stackEnvironments.ts";

/**
 * One stack deploy: a revision applied to a stack environment through its
 * estate, and what became of it.
 *
 * ## Its own table, not `deployments`
 *
 * A `deployments` row is "these bytes on this app instance", with a required
 * instance and an artifact snapshot; a stack deploy names a stack environment
 * and a revision bundle, and holds several services' outcomes. Bending one
 * table to both would make every column of each optional for the other.
 *
 * ## The status follows the estate command
 *
 * {@link commandId} is the `estate_commands` row the deploy rode on (soft:
 * the command history is pruned, this row is not). While the command is
 * open the status is read from it; once it is terminal the status is
 * written here, so the log survives a Worker restart and the command's
 * pruning alike.
 *
 * {@link plan}, {@link services} and {@link warnings} are what the machine
 * uploaded when the revision was applied, as JSON.
 */
export const stackDeployments = $entity({
  name: "stack_deployments",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    environmentId: db.ref(z.uuid(), () => stackEnvironments.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The revision applied: its id (soft) and its number, the snapshot.
     */
    revisionId: z.uuid(),
    revision: z.integer().min(1),
    sha256: z.string().min(64).max(64),
    estateId: z.uuid(),
    commandId: z.uuid(),
    status: z.enum(["queued", "running", "succeeded", "failed"]),
    /**
     * The last progress step the machine reported, `downloading` to
     * `deploying`.
     */
    step: z.string().max(32).optional(),
    error: z.string().max(2_000).optional(),
    plan: z.string().max(20_000).optional(),
    services: z.string().max(50_000).optional(),
    warnings: z.string().max(10_000).optional(),
    finishedAt: z.datetime().optional(),
    createdBy: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["environmentId", "createdAt"] },
    { columns: ["commandId"] },
    { columns: ["projectId"] },
  ],
});

export type StackDeployment = Infer<typeof stackDeployments.schema>;
