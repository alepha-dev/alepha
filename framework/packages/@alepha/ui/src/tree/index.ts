/**
 * A controlled tree.
 *
 * `treeModel`'s functions are the pure half: build, flatten, cycle-safe parents
 * and drop resolution. `TreeView` draws the rows with their indent guides and
 * ARIA tree roles; drag and drop, inline rename and a context-menu slot are
 * opt-ins. `useTreeState` holds the gesture state; the pane handle is
 * `PaneResizer`, in the core entry.
 *
 * @module alepha.ui.tree
 */

export {
  buildTree,
  dropContainerOf,
  findNode,
  flattenTree,
  nodeHolds,
  resolveDrop,
  TREE_ROOT_ID,
  type TreeDropPosition,
  type TreeDropTarget,
  type TreeItem,
  type TreeNode,
  type TreeRow,
} from "./treeModel.ts";
export {
  type TreeRowState,
  TreeView,
  type TreeViewProps,
} from "./TreeView.tsx";
export { type TreeSelectOptions } from "./TreeViewRow.tsx";
export {
  type TreeState,
  type TreeStateCommands,
  useTreeState,
  type UseTreeStateOptions,
} from "./useTreeState.ts";
