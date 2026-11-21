import { type Infer, z } from "alepha";

/**
 * A slice of a running job's output, wire format v1 (#Q3983): Bay follows
 * the job's stdout and stderr and sends them batched (about 500 ms or
 * 16 KB) on the host's socket, the first stream this connection carries.
 *
 * `offset` is where `data` starts in its stream, in bytes from the job's
 * first one. It is what makes a replay safe: after a reconnect Bay sends
 * again from a little before where it stopped, since a frame written into a
 * dying socket may never have been read, and Lore keeps only the bytes past
 * what it already holds. `truncated` is set once, on the frame that reaches
 * Bay's per-job cap.
 *
 * `id` is the `job-run` command's id; a machine can only speak for its own
 * host's commands, whatever id it names.
 */
export const hostLogFrameSchema = z.object({
  type: z.literal("log"),
  id: z.uuid(),
  stream: z.enum(["stdout", "stderr"]),
  offset: z.integer().min(0),
  data: z.string().max(65_536),
  truncated: z.boolean().optional(),
});

export type HostLogFrame = Infer<typeof hostLogFrameSchema>;
