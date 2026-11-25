import { type Infer, z } from "alepha";

import { hostJobTotalsSchema } from "./hostJobTotalsSchema.ts";

/**
 * What a machine says about a command, wire format v1: `running` on pickup
 * (with a `step` for a deploy's progress), then `done` or `failed` with a
 * `reason`. Scoped by the connection it arrives on: a machine can only
 * acknowledge its own host's commands, whatever id it names.
 */
export const hostAckFrameSchema = z.object({
  type: z.literal("ack"),
  id: z.uuid(),
  /**
   * `timed_out` and `cancelled` end a `job-run` only (#Q3983): killed at its
   * deadline, or by a `job-cancel`. The command row records either as
   * `failed`; the job row keeps the distinction.
   */
  status: z.enum(["running", "done", "failed", "timed_out", "cancelled"]),
  step: z.string().max(32).optional(),
  reason: z.string().max(2000).optional(),
  /**
   * Where a deploy answers, on its terminal `done` ack only (#Q3155): the
   * `https://<domain>/` `bay deploy` prints. Bounded like `deployments.url`.
   */
  url: z.string().max(500).optional(),
  /**
   * Where the deployed instance's `APP_SECRET` came from (`kept`,
   * `snapshot`, `lore`, `minted`), on a deploy's `done` ack. Never the key.
   */
  appSecretSource: z.string().max(20).optional(),
  /**
   * What the deploy has to say without failing: it started on an empty
   * database, or on a key minted over restored data. Bounded like `reason`.
   */
  warning: z.string().max(2000).optional(),
  /**
   * A `job-run`'s exit status, on its terminal ack when the process ran to
   * an exit.
   */
  exitCode: z.integer().optional(),
  /**
   * The commit a `job-run`'s source resolved (#E173), on its terminal ack:
   * what a read job read, what a write job's branch started from.
   */
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  /**
   * An agent job's final reply (#Q4288), read by Bay from the agent's
   * stream as it passed, on its terminal ack; cut to 32 KB with
   * `resultTruncated`. Absent from an older Bay, from a job that printed no
   * final line, and from an agent that ended on an error.
   */
  result: z.string().max(32_768).optional(),
  resultTruncated: z.boolean().optional(),
  /**
   * What an agent job's run cost, as its agent CLI said at its end
   * (#Q4293): turns, tokens in (the cache's included) and out, dollars. On
   * its terminal ack, a failed run's too. Absent from an older Bay and from
   * a run that printed no final line.
   */
  totals: hostJobTotalsSchema.optional(),
});

export type HostAckFrame = Infer<typeof hostAckFrameSchema>;
