import { type Infer, z } from "alepha";

/**
 * What an agent job's run cost (#Q4293), as its agent CLI said in its final
 * result line and Bay sent with the job's end: turns, tokens in (the
 * cache's reads and writes included) and out, and dollars. Each absent when
 * the CLI did not say it.
 */
export const hostJobTotalsSchema = z.object({
  turns: z.integer().min(0).optional(),
  inputTokens: z.integer().min(0).optional(),
  outputTokens: z.integer().min(0).optional(),
  costUsd: z.number().min(0).optional(),
});

export type HostJobTotals = Infer<typeof hostJobTotalsSchema>;
