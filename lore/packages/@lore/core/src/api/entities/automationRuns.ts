import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { automationRunSnapshotSchema } from "../schemas/automationRunSnapshotSchema.ts";
import { automationRunStatusSchema } from "../schemas/automationRunStatusSchema.ts";
import { automations } from "./automations.ts";
import { projects } from "./projects.ts";

export const automationRuns = $entity({
  name: "automation_runs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    automationId: db.ref(z.uuid(), () => automations.cols.id, {
      onDelete: "restrict",
    }),
    ruleRevision: z.integer().nonnegative(),
    occurrenceId: z.string().min(1).max(255),
    triggeredAt: z.datetime(),
    status: automationRunStatusSchema.meta({ mode: "text" }),
    reason: z.string().max(1024).optional(),
    snapshot: automationRunSnapshotSchema,
    createdAt: db.createdAt(),
    finishedAt: z.datetime().optional(),
  }),
  indexes: [
    { columns: ["automationId", "createdAt", "id"] },
    { columns: ["projectId", "createdAt", "id"] },
    { columns: ["finishedAt", "id"] },
  ],
});

export type AutomationRun = Infer<typeof automationRuns.schema>;
