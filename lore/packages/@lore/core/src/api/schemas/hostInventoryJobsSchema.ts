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
});

export type HostJobTool = Infer<typeof hostJobToolSchema>;

export const hostInventoryJobsSchema = z.object({
  user: z.string().max(64).optional(),
  /** The `job-run` command running now, if any. */
  running: z.string().max(64).optional(),
  /**
   * What the jobs user has on its PATH (#Q4220): each agent CLI Bay has an
   * adapter for (`kind: "agent"`), then git, gh and lore (`kind: "tool"`),
   * found or not, with a version or the error of its version command.
   * Whether one is signed in is not checked.
   */
  tools: z.array(hostJobToolSchema).max(20).optional(),
  /**
   * The machine prepares a job's source, none, read or write (#E173): Lore
   * sends a read or write job to no host that does not say so, since an
   * older Bay refuses a spec that carries `source` as unreadable.
   */
  sources: z.boolean().optional(),
});

export type HostInventoryJobs = Infer<typeof hostInventoryJobsSchema>;
