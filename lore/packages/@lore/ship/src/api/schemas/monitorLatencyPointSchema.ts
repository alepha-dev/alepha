import { z } from "alepha";
export const monitorLatencyPointSchema = z.object({
  bucket: z.string(),
  latencyMs: z.number().nullable(),
  count: z.number(),
});
