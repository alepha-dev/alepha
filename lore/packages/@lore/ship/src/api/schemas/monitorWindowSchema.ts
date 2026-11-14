import { type Infer, z } from "alepha";
export const monitorWindowSchema = z.enum(["24h", "7d", "30d"]);
export type MonitorWindow = Infer<typeof monitorWindowSchema>;
