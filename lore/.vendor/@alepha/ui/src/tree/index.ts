/**
 * A controlled tree.
 *
 * `treeModel`'s functions are the pure half: build, flatten, cycle-safe parents
 * and drop resolution. `TreeView` draws the rows with their indent guides and
 * ARIA tree roles; drag and drop, inline rename and a context-menu slot are
 * opt-ins. `useTreeState` holds the gesture state and `TreeViewResizer` is the
 * pane handle.
 *
 * @module alepha.ui.tree
 */

export {
  buildTree,
  findNode,
  flattenTree,
  nodeHolds,
  resolveDrop,
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
export {
  TREE_VIEW_DEFAULT_WIDTH,
  TREE_VIEW_MAX_WIDTH,
  TREE_VIEW_MIN_WIDTH,
  TreeViewResizer,
  type TreeViewResizerProps,
} from "./TreeViewResizer.tsx";
export {
  type TreeState,
  type TreeStateCommands,
  useTreeState,
  type UseTreeStateOptions,
} from "./useTreeState.ts";
