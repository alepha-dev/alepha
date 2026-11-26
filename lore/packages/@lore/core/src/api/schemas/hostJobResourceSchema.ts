import { type Infer, z } from "alepha";

import { hostJobInputSchema } from "./hostJobInputSchema.ts";
import { hostJobPokeSchema } from "./hostJobPokeSchema.ts";
import { HOST_JOB_KINDS, HOST_JOB_STATUSES } from "./hostJobValues.ts";
import { promptJobArgSchema } from "./promptJobArgSchema.ts";
import { promptJobCauseSchema } from "./promptJobCauseSchema.ts";

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
  /**
   * The prompt a run ran, its args and its cause (#Q4275), and the agent's
   * final reply with whether Bay cut it.
   */
  prompt: z.string().optional(),
  args: z.array(promptJobArgSchema).optional(),
  cause: promptJobCauseSchema.optional(),
  result: z.string().optional(),
  resultTruncated: z.boolean().optional(),
  /**
   * Whether the job's host returns replies (#Q4288): absent, a job that
   * ended with no reply says to upgrade Bay there.
   */
  hostReturnsResult: z.boolean().optional(),
  /**
   * The model that ran (#Q4304): the one the run named, or, when it named
   * none, the one the agent CLI reported at its start. Answered by one job's
   * read once the job has ended, never by a list.
   */
  model: z.string().optional(),
  /**
   * What the run cost, as its agent CLI said at its end (#Q4293): stored
   * from Bay's terminal ack. Absent for an older Bay and older jobs, whose
   * page reads them from the log instead.
   */
  turns: z.integer().optional(),
  inputTokens: z.integer().optional(),
  outputTokens: z.integer().optional(),
  costUsd: z.number().optional(),
  /**
   * Whether a member can poke the job now (#Q4456): a running agent job
   * whose agent and Bay read messages while it runs. With `pokes`, what was
   * sent so far. Answered by one job's read, never by a list.
   */
  pokeable: z.boolean().optional(),
  pokes: z.array(hostJobPokeSchema).optional(),
});

export type HostJobResource = Infer<typeof hostJobResourceSchema>;
