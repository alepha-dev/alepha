import { type Infer, z } from "alepha";

import { automationGraphEdgeSchema } from "./automationGraphEdgeSchema.ts";
import { automationGraphNodeSchema } from "./automationGraphNodeSchema.ts";

/**
 * An automation, version 2 (#E155, #Q3803): a small graph of sources wired
 * through reads and conditions to actions. The shape is checked here; what
 * the graph means (sources 1 to 8, acyclic, reachable, the fields each node
 * may use, the runner's bounds) is `AutomationGraph.check`.
 */
export const automationGraphSchema = z
  .object({
    version: z.literal(2),
    nodes: z.array(automationGraphNodeSchema).min(1).max(40),
    edges: z.array(automationGraphEdgeSchema).max(200),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (ids.has(node.id))
        ctx.addIssue({
          code: "custom",
          message: `node '${node.id}' is declared twice`,
        });
      ids.add(node.id);
    }
    const wires = new Set<string>();
    for (const edge of graph.edges) {
      const key = `${edge.from}\u0000${edge.port}\u0000${edge.to}`;
      if (wires.has(key))
        ctx.addIssue({
          code: "custom",
          message: `the wire ${edge.from}.${edge.port} -> ${edge.to} is declared twice`,
        });
      wires.add(key);
    }
  });
export type AutomationGraphValue = Infer<typeof automationGraphSchema>;
