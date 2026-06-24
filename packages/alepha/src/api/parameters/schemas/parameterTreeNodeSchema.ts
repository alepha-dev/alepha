import { type Static, z } from "alepha";

/**
 * Tree node schema for parameter tree navigation.
 */
export const parameterTreeNodeSchema = z.object({
  name: z.text(),
  path: z.text(),
  isLeaf: z.boolean(),
  children: z.array(z.any()),
});

export type ParameterTreeNode = Static<typeof parameterTreeNodeSchema>;
