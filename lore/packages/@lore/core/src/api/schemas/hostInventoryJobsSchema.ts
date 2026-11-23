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
export const hostInventoryJobsSchema = z.object({
  runner: z.string().max(20),
  user: z.string().max(64).optional(),
  /** The jobs user's `claude --version`, the first word of it. */
  claudeVersion: z.string().max(100).optional(),
  /** Why the version could not be read: no claude on the user's PATH. */
  claudeError: z.string().max(500).optional(),
  /** The `job-run` command running now, if any. */
  running: z.string().max(64).optional(),
  /**
   * The NAMES of the host-local secrets (`bay secret set`), the Claude
   * credential of a container runner first (#Q3999). Never a value.
   */
  secrets: z.array(z.string().max(64)).max(50).optional(),
});

export type HostInventoryJobs = Infer<typeof hostInventoryJobsSchema>;
