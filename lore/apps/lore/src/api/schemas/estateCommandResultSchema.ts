import { type Infer, z } from "alepha";

/**
 * What a machine answers a `logs` command with.
 *
 * The protocol has no reply channel, so this is not a frame: it is the body
 * of one POST to the machine-facing result route, addressed by command id
 * under the estate secret.
 *
 * ⚠️ **This mirrors `logsResult` in `apps/bay/cmd/bay/logsaction.go`, field
 * for field**, and the pair is pinned by one fixture both suites read
 * (`apps/bay/cmd/bay/testdata/logs-result.json`). It has already drifted once:
 * the first cut here accepted `lines: string[]`, so every real upload would
 * have been a 400 and the three flags below would have been stripped in
 * silence. The fixture exists so that cannot recur.
 *
 * ⚠️ **Three flags, not one, because "no lines" sends an operator to three
 * different places**: an app this Bay has never started (`supervised: false`),
 * a static site that will never have a process, and a supervised app that is
 * simply quiet.
 *
 * `undated` counts lines that carry no timestamp and were kept regardless of
 * a `--since` window: an app writing plain text to stdout produces nothing
 * else, and hiding them would suppress exactly the `console.log` somebody just
 * added. `truncated` counts lines dropped to fit the cap, oldest first.
 *
 * Bounded on the way in, because this is the only command whose answer is a
 * payload rather than an ack, and the payload comes from the machine. The line
 * count is Bay's own `maxLogRequest`; the per-line cap is generous for a
 * journal line and small enough that the worst case stays inside the byte cap
 * the route enforces on top.
 */
export const estateCommandResultSchema = z.object({
  supervised: z.boolean(),
  static: z.boolean().optional(),
  undated: z.integer().min(0).optional(),
  truncated: z.integer().min(0).optional(),
  lines: z
    .array(
      z.object({
        /** The entry's own timestamp, or the journal's. Absent on a plain line. */
        at: z.string().max(40).optional(),
        level: z.string().max(20).optional(),
        /** The message once the envelope is peeled off, when there was one. */
        text: z.string().max(2000).optional(),
        /** The line exactly as it was written. Always present. */
        raw: z.string().max(2000),
      }),
    )
    .max(2000),
});

export type EstateCommandResult = Infer<typeof estateCommandResultSchema>;
