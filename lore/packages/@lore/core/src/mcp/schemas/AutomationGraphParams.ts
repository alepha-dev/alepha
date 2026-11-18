import { z } from "alepha";

import { automationCompactSchema } from "../../api/schemas/automationCompactSchema.ts";
import { automationGraphEdgeSchema } from "../../api/schemas/automationGraphEdgeSchema.ts";
import { automationGraphNodeSchema } from "../../api/schemas/automationGraphNodeSchema.ts";

/**
 * How a tool writes an automation (#Q3809): the graph as `nodes` and
 * `edges`, or the compact `sources` and `actions`. Shared by
 * `automation_create` and `automation_update`.
 */
export class AutomationGraphParams {
  public static readonly SHAPE = {
    nodes: z
      .array(automationGraphNodeSchema)
      .max(40)
      .describe(
        "The graph's nodes: { id, kind (source | read | condition | action), type (from automation_catalog's nodeTypes), config, enabled? on a source }. A node has no position: a graph stores no drawing, and a node posted with one is refused.",
      )
      .optional(),
    edges: z
      .array(automationGraphEdgeSchema)
      .max(200)
      .describe(
        "The graph's wires: { from, port (out, or true / false from a condition), to }.",
      )
      .optional(),
    sources: automationCompactSchema.shape.sources
      .describe(
        "The compact form, with actions: what starts the automation, { type, config? }. Every source is wired to every action, so an action may name only the fields every source has.",
      )
      .optional(),
    actions: automationCompactSchema.shape.actions
      .describe(
        "The compact form, with sources: what it does, { type, config } as a node's.",
      )
      .optional(),
  };

  /**
   * The write body a tool's params make: the graph as `rule`, or the
   * compact form as is.
   */
  public static body(params: {
    nodes?: unknown[];
    edges?: unknown[];
    sources?: unknown[];
    actions?: unknown[];
  }) {
    return params.nodes
      ? {
          rule: {
            version: 2 as const,
            nodes: params.nodes,
            edges: params.edges ?? [],
          } as never,
        }
      : {
          ...(params.sources ? { sources: params.sources as never } : {}),
          ...(params.actions ? { actions: params.actions as never } : {}),
        };
  }
}
