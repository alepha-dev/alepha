import { type Infer, z } from "alepha";

/**
 * How a machine runs one-shot jobs, wire format v1 (#Q3983): as a Unix user
 * of the host (`user`), the job-run commands running now, and what that user
 * has (#Q4220). Absent when no jobs user is configured on it, which reads as
 * a host that cannot run a job whatever its switch says.
 */
/**
 * One tool on a host's jobs user PATH (#Q4220).
 */
export const hostJobToolSchema = z.object({
  name: z.string().max(32),
  kind: z.string().max(10),
  found: z.boolean(),
  version: z.string().max(100).optional(),
  error: z.string().max(500).optional(),
  /**
   * Whether it says it is signed in (#Q4256), from its own status command;
   * absent when it has none (gemini, git) or none could be read. `lore`
   * must not be: a signed-in CLI would reach past a job key's pins.
   */
  signedIn: z.boolean().optional(),
  account: z.string().max(200).optional(),
  /**
   * An agent this machine can send a message while it runs (#Q4456): its
   * jobs offer Poke. Absent on any other, and on an older Bay.
   */
  messages: z.boolean().optional(),
});

export type HostJobTool = Infer<typeof hostJobToolSchema>;

export const hostInventoryJobsSchema = z.object({
  user: z.string().max(64).optional(),
  /**
   * The `job-run` commands running now, comma-joined: as many as the
   * machine's `--max-jobs` (#Q4249, at most 16 on Bay's side).
   */
  running: z.string().max(2400).optional(),
  /**
   * What the jobs user has on its PATH (#Q4220): each agent CLI Bay has an
   * adapter for (`kind: "agent"`), then git, gh and lore (`kind: "tool"`),
   * found or not, with a version or the error of its version command,
   * and its sign-in (#Q4256).
   */
  tools: z.array(hostJobToolSchema).max(20).optional(),
  /**
   * The machine prepares a job's source, none, read or write (#E173): Lore
   * sends a read or write job to no host that does not say so, since an
   * older Bay refuses a spec that carries `source` as unreadable.
   */
  sources: z.boolean().optional(),
  /**
   * How many jobs the machine runs at once, its `--max-jobs` (#Q4249): Lore
   * dispatches up to that many. Absent counts as one.
   */
  maxJobs: z.integer().min(1).max(64).optional(),
  /**
   * How many jobs that change no code it runs beside them, its
   * `--max-read-jobs` (#Q4525): a lane of their own, so a job that reads
   * never waits behind one that changes code. A machine that reports none
   * has one limit for every job, `maxJobs`.
   */
  maxReadJobs: z.integer().min(1).max(64).optional(),
  /**
   * The machine's terminal ack of a job carries the agent's final reply
   * (#Q4288): a host that does not say so leaves its jobs without one.
   */
  result: z.boolean().optional(),
  /**
   * The machine runs a job with the GitHub token its spec carries (#Q4361,
   * #Q4365): Lore sends the token, and skips the jobs user's gh sign-in,
   * only to a host that says so, since an older Bay refuses the field.
   */
  githubTokens: z.boolean().optional(),
});

export type HostInventoryJobs = Infer<typeof hostInventoryJobsSchema>;
