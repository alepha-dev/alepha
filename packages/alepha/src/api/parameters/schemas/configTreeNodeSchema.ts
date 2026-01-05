import { type Static, t } from "alepha";

/**
 * Tree node schema for configuration tree navigation.
 */
export const configTreeNodeSchema = t.object({
  name: t.text(),
  path: t.text(),
  isLeaf: t.boolean(),
  children: t.array(t.any()),
});

export type ConfigTreeNode = Static<typeof configTreeNodeSchema>;
