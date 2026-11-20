import { type Infer, z } from "alepha";

import { monitorCheckBucketSchema } from "./monitorCheckBucketSchema.ts";
import { monitorHeartbeatResourceSchema } from "./monitorHeartbeatResourceSchema.ts";
import { monitorIncidentResourceSchema } from "./monitorIncidentResourceSchema.ts";
import { monitorLatencyPointSchema } from "./monitorLatencyPointSchema.ts";
import { monitorResourceSchema } from "./monitorResourceSchema.ts";
import { monitorUptimeCardSchema } from "./monitorUptimeCardSchema.ts";
import { monitorWindowSchema } from "./monitorWindowSchema.ts";
export const monitorDetailResourceSchema = z.object({
  monitor: monitorResourceSchema,
  beats: z.array(monitorHeartbeatResourceSchema),
  /**
   * The window this detail was read for, and its check bar: the whole
   * window in a fixed number of slices, aggregated here from the hourly
   * history (#Q4009). `beats` stays the last 50, for the app card.
   */
  window: monitorWindowSchema,
  bar: z.array(monitorCheckBucketSchema),
  uptime: z.array(monitorUptimeCardSchema),
  points: z.array(monitorLatencyPointSchema),
  incidents: z.array(monitorIncidentResourceSchema),
  estimated: z.boolean(),
});
export type MonitorDetailResource = Infer<typeof monitorDetailResourceSchema>;
