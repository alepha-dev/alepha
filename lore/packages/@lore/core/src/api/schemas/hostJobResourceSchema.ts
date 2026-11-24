import { type Infer, z } from "alepha";

import { hostJobInputSchema } from "./hostJobInputSchema.ts";
import { HOST_JOB_KINDS, HOST_JOB_STATUSES } from "./hostJobValues.ts";

/**
 * A host job as its page and its list show it (#Q3984). The input is shown
 * whole, prompt included, for a member to see what the agent was asked;
 * the key's scope is shown, the key itself exists nowhere to show.
 */
export const hostJobResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  hostId: z.uuid(),
  hostSlug: z.string().optional(),
  kind: z.enum(HOST_JOB_KINDS),
  status: z.enum(HOST_JOB_STATUSES),
  input: hostJobInputSchema,
  startedBy: z.uuid().optional(),
  startedByName: z.string().optional(),
  startedByJobId: z.uuid().optional(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  commandId: z.uuid().optional(),
  queuedAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  reason: z.string().optional(),
  exitCode: z.integer().optional(),
  commit: z.string().optional(),
  warning: z.string().optional(),
  logBytes: z.integer().optional(),
  logTruncated: z.boolean().optional(),
});

export type HostJobResource = Infer<typeof hostJobResourceSchema>;
