import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * `AnalyticsResult` on the wire. `estimated` / `sampleInterval` are the
 * sampling-honesty fields — declaring them on the response schema is what
 * keeps serialization from silently dropping them, so a UI ignoring them
 * stays a visible choice.
 */
export const adminAnalyticsResultSchema = z.object({
  rows: z.array(z.record(z.text(), z.union([z.text(), z.number()]))),
  estimated: z.boolean(),
  sampleInterval: z.number().optional(),
});

export type AdminAnalyticsResult = Infer<typeof adminAnalyticsResultSchema>;
