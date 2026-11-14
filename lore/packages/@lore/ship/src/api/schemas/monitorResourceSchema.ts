import { type Infer } from "alepha";

import { monitors } from "../entities/monitors.ts";
export const monitorResourceSchema = monitors.schema.omit({
  pushTokenHash: true,
});
export type MonitorResource = Infer<typeof monitorResourceSchema>;
