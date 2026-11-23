import { type Infer, z } from "alepha";

/**
 * How a machine runs one-shot jobs, wire format v1 (#Q3983). Absent when no
 * jobs user is configured on it, which reads as a host that cannot run a
 * job whatever its switch says.
 *
 * `runner` is what the untrusted-input rule reads (#Q3987): `process` runs a
 * job as a Unix user on the host, with that user's shell and Claude
 * credential in reach, so Lore gives it no job on untrusted input;
 * `container` is the runner that lifts the refusal. A bounded string rather
 * than an enum, so a runner a later Bay adds does not make Lore refuse the
 * whole inventory of that machine.
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
  runner: z.string().max(20),
  user: z.string().max(64).optional(),
  /** The `job-run` command running now, if any. */
  running: z.string().max(64).optional(),
  /**
   * The NAMES of the host-local secrets (`bay secret set`), the Claude
   * credential of a container runner first (#Q3999). Never a value.
   */
  secrets: z.array(z.string().max(64)).max(50).optional(),
  /**
   * What the jobs user has on its PATH (#Q4220): each agent CLI Bay has an
   * adapter for (`kind: "agent"`), then git, gh and lore (`kind: "tool"`),
   * found or not, with a version or the error of its version command.
   * Whether one is signed in is not checked.
   */
  tools: z.array(hostJobToolSchema).max(20).optional(),
});

export type HostInventoryJobs = Infer<typeof hostInventoryJobsSchema>;
