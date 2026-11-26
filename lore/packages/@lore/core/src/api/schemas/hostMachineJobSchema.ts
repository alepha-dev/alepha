import { type Infer, z } from "alepha";

import { HOST_JOB_KINDS, HOST_JOB_STATUSES } from "./hostJobValues.ts";
import { promptJobArgSchema } from "./promptJobArgSchema.ts";
import { promptJobCauseSchema } from "./promptJobCauseSchema.ts";

/**
 * A job as its **machine**'s console lists it (#Q4524): every job of a host,
 * whatever its project, read under `host:read` in the host's home project.
 *
 * A job belongs to its project, and a member of the home is not always a
 * member of a project the host is lent to. So a row has two halves:
 *
 * - what the machine knows, answered for every job: its kind and status,
 *   when it waited, ran and ended, what it spent, and its project by name
 *   (the console already lists the projects a host is lent to);
 * - what the project wrote, answered only while `readable`, which is the
 *   reader holding `host:read` in the job's own project: the prompt's name,
 *   its args, its subject, who or what started it, and why it ended.
 *
 * The rendered prompt, the reply and the log are in neither: they are the
 * job page's, gated on the job's project.
 *
 * Built by hand rather than derived from the entity, like
 * `lentHostResourceSchema`: a column added to `host_jobs` must be a decision
 * to show here, and to which half, never a default.
 */
export const hostMachineJobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(HOST_JOB_KINDS),
  status: z.enum(HOST_JOB_STATUSES),
  queuedAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  turns: z.integer().optional(),
  inputTokens: z.integer().optional(),
  outputTokens: z.integer().optional(),
  project: z.object({
    id: z.integer(),
    title: z.string(),
    slug: z.string().optional(),
  }),
  /**
   * Whether the reader may open the job's page: `host:read` in the job's
   * project. Every field below is absent without it.
   */
  readable: z.boolean(),
  prompt: z.string().optional(),
  args: z.array(promptJobArgSchema).optional(),
  cause: promptJobCauseSchema.optional(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  startedByName: z.string().optional(),
  reason: z.string().optional(),
});

export type HostMachineJob = Infer<typeof hostMachineJobSchema>;
