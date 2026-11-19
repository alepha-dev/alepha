import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { automations } from "./automations.ts";
import { projects } from "./projects.ts";

/**
 * ⚠️ Kept until #Q3902 drops the table: nothing reads or writes it since
 * #Q3896 deleted the automation engine. Its columns keep their storage
 * shape, so no migration is generated before the drop.
 */
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
    /**
     * The source node that started the run (#Q3807); absent on a health
     * record. The run list filters on it.
     */
    sourceNode: z.string().max(64).optional(),
    triggeredAt: z.datetime(),
    status: z
      .enum([
        "running",
        "succeeded",
        "skipped",
        "refused",
        "partial",
        "failed",
        "unknown",
      ])
      .meta({ mode: "text" }),
    reason: z.string().max(1024).optional(),
    snapshot: z.record(z.string(), z.any()),
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
