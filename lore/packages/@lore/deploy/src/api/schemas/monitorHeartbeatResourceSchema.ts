import { type Infer } from "alepha";

import { monitorHeartbeats } from "../entities/monitorHeartbeats.ts";
export const monitorHeartbeatResourceSchema = monitorHeartbeats.schema.omit({
  monitorId: true,
});
export type MonitorHeartbeatResource = Infer<
  typeof monitorHeartbeatResourceSchema
>;
