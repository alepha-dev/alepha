import { type Infer, z } from "alepha";

import { automationNodeOutcomeSchema } from "./automationNodeOutcomeSchema.ts";
import { automationNotificationOutcomeSchema } from "./automationNotificationOutcomeSchema.ts";
import { automationRunSnapshotSchema } from "./automationRunSnapshotSchema.ts";
import { automationRunStatusSchema } from "./automationRunStatusSchema.ts";

export const automationRunResourceSchema = z
  .object({
    id: z.uuid(),
    projectId: z.integer(),
    automationId: z.uuid(),
    ruleRevision: z.integer().nonnegative(),
    occurrenceId: z.string().max(255),
    triggeredAt: z.datetime(),
    status: automationRunStatusSchema,
    reason: z.string().max(1024).optional(),
    snapshot: automationRunSnapshotSchema.nullable(),
    /**
     * The source that started the run, and what each node did (#Q3807);
     * no outcomes when redacted.
     */
    sourceNode: z.string().max(64).optional(),
    nodes: z.array(automationNodeOutcomeSchema).max(500),
    notifications: z.array(automationNotificationOutcomeSchema).max(100),
    redacted: z.boolean(),
    redactionReason: z.string().max(255).optional(),
    createdAt: z.datetime(),
    finishedAt: z.datetime().optional(),
  })
  .strict();
export type AutomationRunResource = Infer<typeof automationRunResourceSchema>;
