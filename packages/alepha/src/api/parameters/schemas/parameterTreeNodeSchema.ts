import { type Static, t } from "alepha";

/**
 * Tree node schema for parameter tree navigation.
 */
export const parameterTreeNodeSchema = t.object({
  name: t.text(),
  path: t.text(),
  isLeaf: t.boolean(),
  children: t.array(t.any()),
});

export type ParameterTreeNode = Static<typeof parameterTreeNodeSchema>;
