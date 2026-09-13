/**
 * The pure model behind `TreeView`: no React, no DOM, no application
 * vocabulary. A consumer hands in one flat list and gets back a nested tree,
 * a flattened row list for rendering, and the two helpers a drag gesture
 * needs.
 *
 * Extracted from Lore's folio tree, where every rule below was earned.
 */

/**
 * One item of the flat list a consumer builds its tree from.
 *
 * `branch` is the only structural distinction the model makes: a branch can
 * hold children and takes part in cycle resolution, a leaf can do neither.
 * Everything domain-specific travels in `data`.
 */
export interface TreeItem<T = undefined> {
  id: string;
  name: string;
  parentId?: string;
  /**
   * Can hold children. Only branches take part in cycle resolution, and
   * only a branch accepts an `inside` drop.
   */
  branch: boolean;
  data?: T;
}

/**
 * A node of the built tree.
 */
export interface TreeNode<T = undefined> {
  id: string;
  name: string;
  parentId?: string;
  /**
   * Present only on a branch whose `parentId` above was rewritten by
   * cycle-breaking (see `resolveBranchParents`): holds the parent this
   * item's own record actually declares, which is what the consumer's
   * store still has. Absent everywhere else, including a genuinely
   * root-level node, whose `parentId` already IS the true value, so a
   * consumer can tell the two apart (both show `parentId: undefined`)
   * without re-deriving the cycle analysis itself. Leaves never carry
   * this: only a branch's `parentId` can chain into a cycle.
   */
  declaredParentId?: string;
  branch: boolean;
  data?: T;
  /**
   * Present on every branch (`[]` when empty), absent on a leaf.
   */
  children?: TreeNode<T>[];
}

/**
 * One visible row: a node plus the depth it is drawn at.
 */
export interface TreeRow<T = undefined> {
  node: TreeNode<T>;
  depth: number;
}

/**
 * Where a dragged node landed relative to the row under the cursor.
 */
export type TreeDropPosition = "before" | "after" | "inside";

/**
 * The only thing a drop can change: a new parent. There is no index, because
 * the model has no sort column to write to: sibling order is derived from the
 * comparator, so `before` and `after` collapse to "same parent as the
 * target".
 */
export interface TreeDropTarget {
  parentId: string | undefined;
}

/**
 * Sentinel bucket key for the tree root. A caller's ids come from its own
 * store (uuids, slugs), so this never collides with a real one.
 */
const ROOT = "__root__";

/**
 * Branches sort before leaves at every level; within each group, sort
 * alphabetically by name. Consumers whose server sorts differently pass their
 * own comparator to `buildTree`.
 */
const compareTreeNodes = <T>(a: TreeNode<T>, b: TreeNode<T>): number => {
  const aIsBranch = a.branch ? 0 : 1;
  const bIsBranch = b.branch ? 0 : 1;
  if (aIsBranch !== bIsBranch) return aIsBranch - bIsBranch;
  return a.name.localeCompare(b.name);
};

/**
 * The effective parent per branch, alongside the branches whose parent that
 * rewrite actually changed.
 */
interface ResolvedBranchParents {
  parentId: Map<string, string | undefined>;
  promoted: Set<string>;
}

/**
 * For every branch, resolve the parent id to actually use when building the
 * tree.
 *
 * A branch's declared `parentId` is used as-is when it points at a real
 * branch AND following it, then its parent, and so on, reaches the root
 * without revisiting a branch already on the walk. Both other cases fall back
 * to root, the same treatment already given to a `parentId` that points
 * nowhere:
 *
 * - the declared parent does not exist among the branches (stale reference,
 *   concurrent delete);
 * - the chain cycles. A server that guards against a direct cycle usually
 *   does it as two separate, non-atomic round-trips, and two clients each
 *   reading pre-move state can each pass that check independently and
 *   together still produce `A.parentId === B.id && B.parentId === A.id`.
 *   Bucketing a cyclic branch under its "parent" (which is itself never
 *   reachable from root through this chain) would silently drop it, and
 *   everything nested under it, leaves included, from the tree the user sees,
 *   with no error and no broken row to recover by dragging.
 *
 * When a cycle is found, only the branch where the walk first revisits a node
 * is promoted to root; every other branch on the cycle keeps its own declared
 * parent unchanged. A cycle has no correct direction once it has to be
 * broken, so *which* member becomes the root is a choice: this implementation
 * promotes whichever member the walk reaches first, a deterministic function
 * of the order `items` was given in, not a random pick, but the decision that
 * actually matters is *that* exactly one member is promoted, rather than
 * scattering every member of the cycle to the root as unrelated top-level
 * siblings. Cutting a single edge keeps the rest of the cycle nested exactly
 * as declared, one level under the promoted node, discarding the least
 * structure and leaving the tree closest to whatever was intended before it
 * became corrupted.
 *
 * Returns the effective parent per branch alongside `promoted`: the set of
 * branches where that rewrite actually happened (as opposed to a branch that
 * was already root, or already orphaned by a missing parent). `buildTree`
 * uses `promoted` to record each such branch's true declared parent on its
 * node (`declaredParentId`): the tree's `parentId` alone cannot be trusted to
 * match the store once a cycle has been broken, and callers like
 * `resolveDrop` need to tell the difference without re-running this analysis
 * themselves.
 */
const resolveBranchParents = <T>(
  branches: TreeItem<T>[],
): ResolvedBranchParents => {
  const branchIds = new Set(branches.map((b) => b.id));
  const byId = new Map(branches.map((b) => [b.id, b]));
  const rawParentOf = (id: string): string | undefined => {
    const parentId = byId.get(id)?.parentId;
    return parentId && branchIds.has(parentId) ? parentId : undefined;
  };

  const resolved = new Map<string, string | undefined>();
  const promoted = new Set<string>();

  for (const start of branches) {
    if (resolved.has(start.id)) continue;

    // Walk the parent chain, recording the path taken on this walk and
    // where in it each id sits. Bounded by `branches.length`: with
    // exactly one outgoing edge per node, a walk longer than the total
    // branch count must have revisited one, so this cannot spin even on
    // adversarial input.
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cur: string | undefined = start.id;
    let cycleAt = -1;
    while (cur !== undefined && path.length <= branches.length) {
      if (resolved.has(cur)) break;
      const seenAt = pathIndex.get(cur);
      if (seenAt !== undefined) {
        cycleAt = seenAt;
        break;
      }
      pathIndex.set(cur, path.length);
      path.push(cur);
      cur = rawParentOf(cur);
    }

    for (let i = 0; i < path.length; i++) {
      if (i === cycleAt) {
        resolved.set(path[i], undefined);
        promoted.add(path[i]);
      } else {
        resolved.set(path[i], rawParentOf(path[i]));
      }
    }
  }

  return { parentId: resolved, promoted };
};

/**
 * Assemble one flat list of items into a nested tree. Branches sort before
 * leaves at every level, each group alphabetically, unless `compare` says
 * otherwise. Match the consumer's own server ordering and the tree does not
 * jump after a save.
 *
 * Every item in the input appears exactly once in the result, reachable from
 * the root: a leaf pointing at a parent that is not in the list, or at
 * another leaf, falls back to the root rather than disappearing, and so does
 * a branch whose declared parent is missing or whose parent chain cycles (see
 * `resolveBranchParents`).
 */
export const buildTree = <T>(
  items: TreeItem<T>[],
  compare: (a: TreeNode<T>, b: TreeNode<T>) => number = compareTreeNodes,
): TreeNode<T>[] => {
  const branches = items.filter((item) => item.branch);
  const branchIds = new Set(branches.map((b) => b.id));
  const { parentId: branchParents, promoted } = resolveBranchParents(branches);

  const childrenByParent = new Map<string, TreeNode<T>[]>();
  const childrenOf = (key: string): TreeNode<T>[] => {
    const existing = childrenByParent.get(key);
    if (existing) return existing;
    const created: TreeNode<T>[] = [];
    childrenByParent.set(key, created);
    return created;
  };

  for (const item of items) {
    if (item.branch) {
      const parentId = branchParents.get(item.id);
      childrenOf(parentId ?? ROOT).push({
        id: item.id,
        name: item.name,
        parentId,
        // A promoted branch's raw `item.parentId` is always defined
        // here: a cycle only closes through branches that exist,
        // which is exactly what "promoted" means.
        declaredParentId: promoted.has(item.id) ? item.parentId : undefined,
        branch: true,
        data: item.data,
        children: [],
      });
      continue;
    }
    // A leaf's parent has to be an existing branch. Pointing at nothing
    // and pointing at another leaf are the same failure, and both land at
    // the root.
    const parentId =
      item.parentId && branchIds.has(item.parentId) ? item.parentId : undefined;
    childrenOf(parentId ?? ROOT).push({
      id: item.id,
      name: item.name,
      parentId,
      branch: false,
      data: item.data,
    });
  }

  // Every branch node was created with `children: []`; now that every node
  // has been bucketed by its resolved parent, wire each branch up to its
  // actual children and sort every level.
  for (const siblings of childrenByParent.values()) {
    for (const node of siblings) {
      if (node.branch) {
        node.children = (childrenByParent.get(node.id) ?? []).sort(compare);
      }
    }
  }

  return (childrenByParent.get(ROOT) ?? []).sort(compare);
};

/**
 * Depth-first walk producing one row per visible node. A collapsed branch
 * contributes its own row and nothing beneath it.
 */
export const flattenTree = <T>(
  nodes: TreeNode<T>[],
  collapsed: ReadonlySet<string>,
): TreeRow<T>[] => {
  const rows: TreeRow<T>[] = [];
  const walk = (list: TreeNode<T>[], depth: number): void => {
    for (const node of list) {
      rows.push({ node, depth });
      if (node.children?.length && !collapsed.has(node.id)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return rows;
};

/**
 * Depth-first search for the node with the given id, anywhere in the tree.
 */
export const findNode = <T>(
  nodes: TreeNode<T>[],
  id: string,
): TreeNode<T> | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = node.children ? findNode(node.children, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
};

/**
 * True when `id` is `node` itself or anywhere beneath it. Guards against
 * dropping a branch into its own subtree, which would orphan it.
 */
export const nodeHolds = <T>(node: TreeNode<T>, id: string): boolean =>
  node.id === id || (node.children ?? []).some((child) => nodeHolds(child, id));

/**
 * Turn a drag gesture into the one mutation a store can persist: a new
 * parent. Returns `undefined` when the move is illegal or a no-op, in which
 * case the caller must not issue a request.
 *
 * `nodeHolds(dragged, targetId)` is the single cycle guard for both "inside"
 * and "before"/"after": whichever position is used, the resolved parent is
 * either `target` itself or `target`'s existing parent, and a node's parent
 * is always inside that node's own subtree (or the node itself, one level
 * up). So if the resolved parent would be `dragged` or a descendant of
 * `dragged`, then `target` itself is already inside `dragged`'s subtree,
 * which this single check catches regardless of `position`.
 *
 * The no-op check compares the resolved new parent against `dragged`'s
 * *stored* parent, `dragged.declaredParentId ?? dragged.parentId`, not
 * `dragged.parentId` alone. For an ordinary node the two are the same value,
 * so this changes nothing. For a cycle-promoted branch they differ: its tree
 * `parentId` already reads `undefined` (root) even though the store still has
 * it parented on the cyclic value. Comparing against the tree's rewritten
 * `parentId` would make the one drag that actually repairs the corruption,
 * dragging the promoted node to root, which resolves to
 * `{ parentId: undefined }`, indistinguishable from a true no-op, and
 * silently drop the write that clears it. Using the stored parent means that
 * drag (and, in fact, any legal destination for that node, since its true
 * parent is the broken cyclic value and no legal destination can equal it:
 * the cycle guard above already refuses every target that would) resolves to
 * a real write instead.
 */
export const resolveDrop = <T>(
  nodes: TreeNode<T>[],
  dragId: string,
  targetId: string,
  position: TreeDropPosition,
): TreeDropTarget | undefined => {
  if (dragId === targetId) return undefined;

  const dragged = findNode(nodes, dragId);
  const target = findNode(nodes, targetId);
  if (!dragged || !target) return undefined;

  if (nodeHolds(dragged, targetId)) return undefined;

  const draggedStoredParentId = dragged.declaredParentId ?? dragged.parentId;

  if (position === "inside") {
    // Dropping "inside" only means something on a branch; a leaf cannot
    // hold children.
    if (!target.branch) return undefined;
    if (target.id === draggedStoredParentId) return undefined;
    return { parentId: target.id };
  }

  if (target.parentId === draggedStoredParentId) return undefined;
  return { parentId: target.parentId };
};
