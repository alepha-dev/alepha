import { type Infer, z } from "alepha";

/**
 * Where a node sits on the canvas. Optional on input: a graph saved without
 * positions is laid out by `AutomationGraph.layout`.
 */
export const automationGraphPositionSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })
  .strict();
export type AutomationGraphPosition = Infer<
  typeof automationGraphPositionSchema
>;
