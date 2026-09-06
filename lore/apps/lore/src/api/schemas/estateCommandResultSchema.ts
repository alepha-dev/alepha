import { type Infer, z } from "alepha";

/**
 * What a machine answers a `logs` command with.
 *
 * The protocol has no reply channel, so this is not a frame: it is the body
 * of one POST to the machine-facing result route, addressed by command id
 * under the estate secret.
 *
 * ⚠️ Bounded on the way in, because this is the only command whose answer is
 * a payload rather than an ack, and the payload comes from the machine. The
 * line count is Bay's own `maxLogRequest`; the per-line cap is generous for a
 * journal line and small enough that the worst case stays inside the byte cap
 * the route enforces on top.
 *
 * `truncated` is how many lines Bay dropped to fit, counted rather than
 * implied: a tail silently missing its oldest lines is a tail somebody reads
 * the wrong conclusion from.
 */
export const estateCommandResultSchema = z.object({
  lines: z.array(z.string().max(2000)).max(2000),
  truncated: z.integer().min(0).optional(),
});

export type EstateCommandResult = Infer<typeof estateCommandResultSchema>;
