import { type Infer, z } from "alepha";

import { monitorHeartbeatResourceSchema } from "./monitorHeartbeatResourceSchema.ts";
import { monitorIncidentResourceSchema } from "./monitorIncidentResourceSchema.ts";
import { monitorLatencyPointSchema } from "./monitorLatencyPointSchema.ts";
import { monitorResourceSchema } from "./monitorResourceSchema.ts";
import { monitorUptimeCardSchema } from "./monitorUptimeCardSchema.ts";
export const monitorDetailResourceSchema = z.object({
  monitor: monitorResourceSchema,
  beats: z.array(monitorHeartbeatResourceSchema),
  uptime: z.array(monitorUptimeCardSchema),
  points: z.array(monitorLatencyPointSchema),
  incidents: z.array(monitorIncidentResourceSchema),
  estimated: z.boolean(),
});
export type MonitorDetailResource = Infer<typeof monitorDetailResourceSchema>;
