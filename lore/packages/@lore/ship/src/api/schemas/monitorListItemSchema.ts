import { type Infer, z } from "alepha";

import { monitorHeartbeatResourceSchema } from "./monitorHeartbeatResourceSchema.ts";
import { monitorResourceSchema } from "./monitorResourceSchema.ts";
export const monitorListItemSchema = monitorResourceSchema.extend({
  uptimePct: z.number().nullable(),
  beats: z.array(monitorHeartbeatResourceSchema),
});
export type MonitorListItem = Infer<typeof monitorListItemSchema>;
