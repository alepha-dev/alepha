import { type Infer, z } from "alepha";

import { monitorListItemSchema } from "./monitorListItemSchema.ts";
export const monitorListResourceSchema = z.object({
  items: z.array(monitorListItemSchema),
  estimated: z.boolean(),
});
export type MonitorListResource = Infer<typeof monitorListResourceSchema>;
