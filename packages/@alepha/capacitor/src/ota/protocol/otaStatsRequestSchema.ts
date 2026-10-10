import { type Infer, z } from "alepha";

import { otaStatsEventSchema } from "./otaStatsEventSchema.ts";

/**
 * The body of `POST /ota/stats`: the pinned updater sends a batch, an array
 * of at most 200 events, and a single event for its rate-limit report.
 */
export const otaStatsRequestSchema = z.union([
  z.array(otaStatsEventSchema).max(200),
  otaStatsEventSchema,
]);

export type OtaStatsRequest = Infer<typeof otaStatsRequestSchema>;
