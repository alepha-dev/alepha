import { type Infer, z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";

/**
 * A wire from one port of a node to a node. A condition has a `true` and a
 * `false` port; every other node has `out`. Several edges may leave one port
 * (fan-out) and several may enter one node (fan-in).
 */
export const automationGraphEdgeSchema = z
  .object({
    from: automationGraphNodeIdSchema,
    port: z.enum(["out", "true", "false"]),
    to: automationGraphNodeIdSchema,
  })
  .strict();
export type AutomationGraphEdge = Infer<typeof automationGraphEdgeSchema>;
