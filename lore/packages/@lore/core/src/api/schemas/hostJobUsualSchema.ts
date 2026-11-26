import { type Infer, z } from "alepha";

/**
 * How long a prompt usually takes (#Q4435, epic #E181): from the last 20
 * succeeded runs of the same project, prompt, prompt text (its hash) and
 * model, in seconds. `low` to `high` is their middle half (25th to 75th
 * percentile), the words beside the bar; `p90` is where the bar reaches
 * 90% and holds. Absent under 5 runs.
 */
export const hostJobUsualSchema = z.object({
  runs: z.integer().min(1),
  low: z.integer().min(0),
  high: z.integer().min(0),
  p90: z.integer().min(0),
});

export type HostJobUsual = Infer<typeof hostJobUsualSchema>;
