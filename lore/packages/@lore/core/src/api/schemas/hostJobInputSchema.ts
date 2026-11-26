import { type Infer, z } from "alepha";

/**
 * What a host job runs, as stored on its row (#Q3984, light since #Q4222):
 * Lore's half of Bay's `jobSpec`, without the credential. The job key is
 * minted when the machine pulls the spec, so no row ever holds it; `key`
 * here is only its pins.
 *
 * Bounded like Bay bounds it, so a spec Lore would build is never one Bay
 * refuses for its size. Bay validates every field again and builds the
 * command line from its adapter for the agent.
 */
/**
 * The code an agent job finds when it starts (#E173), prepared by Bay before
 * the agent runs, so the agent never clones or fetches:
 *
 * - `none`: an empty workspace, for a project with no GitHub repository or a
 *   prompt that needs none;
 * - `read`: the repository at `ref`, checked out read-only at `./src`;
 * - `write`: a git worktree on `branch`, continued from the remote when it
 *   exists, made from `ref` otherwise.
 *
 * `ref` is a branch, a tag, a commit or `pull/<n>/head`, the default branch
 * when absent. The repository is not stored: the spec takes the project's
 * when the host pulls it. Bounded like Bay bounds it.
 */
export const hostJobSourceSchema = z.object({
  mode: z.enum(["none", "read", "write"]),
  ref: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/)
    .optional(),
  branch: z
    .string()
    .regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/)
    .optional(),
  /** A pull request whose author must be able to write (#Q4251). */
  trust: z.enum(["pr-author-writes"]).optional(),
  /**
   * A write job continuing one that ended unfinished (#Q4340): Bay runs it
   * in the worktree that job kept on `branch`, its uncommitted changes
   * included, instead of refusing it. Sent on a continued run only, since a
   * Bay before it refuses the field.
   */
  resume: z.boolean().optional(),
});

export type HostJobSource = Infer<typeof hostJobSourceSchema>;

export const hostJobInputSchema = z.object({
  agent: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .optional(),
  model: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,79}(?:\[1m\])?$/)
    .optional(),
  workspace: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .optional(),
  prompt: z.string().max(131_072).optional(),
  /** Absent is `none`: a job queued before sources (#E173). */
  source: hostJobSourceSchema.optional(),
  /**
   * `json` for a chat agent's turn (#Q4250): its answer is read from the
   * CLI's one JSON result when the job ends.
   */
  output: z.enum(["json"]).optional(),
  /**
   * The conversation the turn starts, or resumes once a job that used it
   * ended done (#Q4250).
   */
  session: z
    .object({ id: z.uuid(), resume: z.boolean().optional() })
    .optional(),
  timeoutSeconds: z.integer().min(10).max(43_200),
  key: z
    .object({
      questId: z.integer().optional(),
      feedbackId: z.integer().optional(),
      feedbackIds: z.array(z.integer()).max(50).optional(),
      epicId: z.integer().optional(),
      errorId: z.integer().optional(),
    })
    .optional(),
});

export type HostJobInputRow = Infer<typeof hostJobInputSchema>;
