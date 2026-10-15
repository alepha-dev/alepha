import { type Infer, z } from "alepha";

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
    redacted: z.boolean(),
    redactionReason: z.string().max(255).optional(),
    createdAt: z.datetime(),
    finishedAt: z.datetime().optional(),
  })
  .strict();
export type AutomationRunResource = Infer<typeof automationRunResourceSchema>;
