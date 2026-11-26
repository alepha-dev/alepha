import { type Infer, z } from "alepha";

import { monitorListItemSchema } from "./monitorListItemSchema.ts";
export const monitorListResourceSchema = z.object({
  items: z.array(monitorListItemSchema),
  estimated: z.boolean(),
  /**
   * Whether this Lore can run `tcp` and `cert` checks: false on a runtime
   * without sockets, where creating one is refused (#Q4431).
   */
  sockets: z.boolean(),
});
export type MonitorListResource = Infer<typeof monitorListResourceSchema>;
