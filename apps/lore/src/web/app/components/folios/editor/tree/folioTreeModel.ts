/**
 * What a tree row represents. `protected` is a folio whose content is a
 * client-side crypto envelope — it gets a padlock instead of a page icon
 * and a different context menu.
 */
export type FolioTreeKind = "directory" | "folio" | "protected";

export interface FolioTreeNode {
  id: string;
  kind: FolioTreeKind;
  name: string;
  shortId: number;
  parentId?: string;
  pinned?: boolean;
  children?: FolioTreeNode[];
}

export interface FolioTreeRow {
  node: FolioTreeNode;
  depth: number;
}

/**
 * Where a dragged node landed relative to the row under the cursor.
 */
export type FolioDropPosition = "before" | "after" | "inside";

/**
 * The only thing a drop can change. `parentId: undefined` is the project
 * root. There is no index: neither `folios` nor `folio_directories` has a
 * sort column, so sibling order is always alphabetical and `before` /
 * `after` collapse to "same parent as the target".
 */
export interface FolioDropTarget {
  parentId: string | undefined;
}

/**
 * Not exported: the brief's interface contract declares `buildFolioTree`'s
 * parameter as an inline object type rather than a named export, so this
 * stays module-private to avoid growing the module's public surface beyond
 * what Task 9 (the React tree pane) is specified to import.
 */
interface BuildFolioTreeInput {
  directories: {
    id: string;
    name: string;
    shortId: number;
    parentId?: string;
  }[];
  folios: {
    id: string;
    title: string;
    shortId: number;
    directoryId?: string;
    pinned?: boolean;
    protected?: boolean;
  }[];
}

/**
 * Sentinel bucket key for the project root. Never collides with a real
 * directory id (those come from the database as uuids).
 */
const ROOT = "__root__";

/**
 * Directories sort before folios at every level; within each group, sort
 * alphabetically by name. This mirrors the server's own ordering so the
 * tree does not visibly reshuffle after a save.
 */
const compareTreeNodes = (a: FolioTreeNode, b: FolioTreeNode): number => {
  const aIsDirectory = a.kind === "directory" ? 0 : 1;
  const bIsDirectory = b.kind === "directory" ? 0 : 1;
  if (aIsDirectory !== bIsDirectory) return aIsDirectory - bIsDirectory;
  return a.name.localeCompare(b.name);
};

/**
 * For every directory, resolve the parent id to actually use when building
 * the tree.
 *
 * A directory's declared `parentId` is used as-is when it points at a real
 * directory (in `directories`) AND following it — then its parent, and so
 * on — reaches the project root without revisiting a directory already on
 * the walk. Both other cases fall back to root, the same treatment already
 * given to a `parentId` that points nowhere:
 *
 * - the declared parent does not exist in `directories` (stale reference,
 *   concurrent delete);
 * - the chain cycles. `FolioDirectoryService.move()` guards against a
 *   direct cycle server-side, but as two separate, non-atomic database
 *   round-trips — two clients each reading pre-move state can each pass
 *   that check independently and together still produce
 *   `A.parentId === B.id && B.parentId === A.id`. There is no database
 *   constraint behind it. Bucketing a cyclic directory under its "parent"
 *   (which is itself never reachable from root through this chain) would
 *   silently drop it, and everything nested under it — folios included —
 *   from the tree the user sees, with no error and no broken row to
 *   recover by dragging.
 *
 * When a cycle is found, only the directory where the walk first revisits
 * a node is promoted to root; every other directory on the cycle keeps its
 * own declared parent unchanged. A cycle has no correct direction once it
 * has to be broken, so *which* member becomes the root is a choice: this
 * implementation promotes whichever member the walk reaches first — a
 * deterministic function of the order `directories` was given in, not a
 * random pick — but the decision that actually matters is *that* exactly
 * one member is promoted, rather than scattering every member of the
 * cycle to the root as unrelated top-level siblings. Cutting a single edge
 * keeps the rest of the cycle nested exactly as declared, one level under
 * the promoted node, discarding the least structure and leaving the tree
 * closest to whatever was intended before it became corrupted.
 */
const resolveDirectoryParents = (
  directories: BuildFolioTreeInput["directories"],
): Map<string, string | undefined> => {
  const directoryIds = new Set(directories.map((d) => d.id));
  const byId = new Map(directories.map((d) => [d.id, d]));
  const rawParentOf = (id: string): string | undefined => {
    const parentId = byId.get(id)?.parentId;
    return parentId && directoryIds.has(parentId) ? parentId : undefined;
  };

  const resolved = new Map<string, string | undefined>();

  for (const start of directories) {
    if (resolved.has(start.id)) continue;

    // Walk the parent chain, recording the path taken on this walk and
    // where in it each id sits. Bounded by `directories.length`: with
    // exactly one outgoing edge per node, a walk longer than the total
    // directory count must have revisited one, so this cannot spin even
    // on adversarial input.
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cur: string | undefined = start.id;
    let cycleAt = -1;
    while (cur !== undefined && path.length <= directories.length) {
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
      resolved.set(path[i], i === cycleAt ? undefined : rawParentOf(path[i]));
    }
  }

  return resolved;
};

/**
 * Assemble the directory + folio lists the route loader provides into one
 * nested tree. Directories sort before folios at every level, each group
 * alphabetically — the same ordering the server uses, so the tree does not
 * jump after a save.
 *
 * Every directory and every folio in the input appears exactly once in the
 * result, reachable from the root: a folio pointing at a directory that is
 * not in the list (stale atom, concurrent delete) falls back to the root
 * rather than disappearing, and so does a directory whose declared parent
 * is missing or whose parent chain cycles (see `resolveDirectoryParents`).
 */
export const buildFolioTree = (input: BuildFolioTreeInput): FolioTreeNode[] => {
  const directoryIds = new Set(input.directories.map((d) => d.id));
  const directoryParents = resolveDirectoryParents(input.directories);

  const childrenByParent = new Map<string, FolioTreeNode[]>();
  const childrenOf = (key: string): FolioTreeNode[] => {
    const existing = childrenByParent.get(key);
    if (existing) return existing;
    const created: FolioTreeNode[] = [];
    childrenByParent.set(key, created);
    return created;
  };

  for (const d of input.directories) {
    const parentId = directoryParents.get(d.id);
    childrenOf(parentId ?? ROOT).push({
      id: d.id,
      kind: "directory",
      name: d.name,
      shortId: d.shortId,
      parentId,
      children: [],
    });
  }

  for (const f of input.folios) {
    const parentId =
      f.directoryId && directoryIds.has(f.directoryId)
        ? f.directoryId
        : undefined;
    childrenOf(parentId ?? ROOT).push({
      id: f.id,
      kind: f.protected ? "protected" : "folio",
      name: f.title,
      shortId: f.shortId,
      parentId,
      pinned: f.pinned,
    });
  }

  // Every directory node was created with `children: []`; now that every
  // node (directory or folio) has been bucketed by its resolved parent,
  // wire each directory up to its actual children and sort every level.
  for (const siblings of childrenByParent.values()) {
    for (const node of siblings) {
      if (node.kind === "directory") {
        node.children = (childrenByParent.get(node.id) ?? []).sort(
          compareTreeNodes,
        );
      }
    }
  }

  return (childrenByParent.get(ROOT) ?? []).sort(compareTreeNodes);
};

/**
 * Depth-first walk producing one row per visible node. A collapsed
 * directory contributes its own row and nothing beneath it.
 */
export const flattenFolioTree = (
  nodes: FolioTreeNode[],
  collapsed: ReadonlySet<string>,
): FolioTreeRow[] => {
  const rows: FolioTreeRow[] = [];
  const walk = (list: FolioTreeNode[], depth: number): void => {
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
export const findFolioNode = (
  nodes: FolioTreeNode[],
  id: string,
): FolioTreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = node.children ? findFolioNode(node.children, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
};

/**
 * True when `id` is `node` itself or anywhere beneath it. Guards against
 * dropping a directory into its own subtree, which would orphan the branch.
 */
export const folioNodeHolds = (node: FolioTreeNode, id: string): boolean =>
  node.id === id ||
  (node.children ?? []).some((child) => folioNodeHolds(child, id));

/**
 * Turn a drag gesture into the one mutation the backend can persist: a new
 * parent directory. Returns `undefined` when the move is illegal or a
 * no-op, in which case the caller must not issue a request.
 *
 * `folioNodeHolds(dragged, targetId)` is the single cycle guard for both
 * "inside" and "before"/"after": whichever position is used, the resolved
 * parent is either `target` itself or `target`'s existing parent — and a
 * node's parent is always inside that node's own subtree (or the node
 * itself, one level up). So if the resolved parent would be `dragged` or a
 * descendant of `dragged`, then `target` itself is already inside
 * `dragged`'s subtree, which this single check catches regardless of
 * `position`.
 */
export const resolveFolioDrop = (
  nodes: FolioTreeNode[],
  dragId: string,
  targetId: string,
  position: FolioDropPosition,
): FolioDropTarget | undefined => {
  if (dragId === targetId) return undefined;

  const dragged = findFolioNode(nodes, dragId);
  const target = findFolioNode(nodes, targetId);
  if (!dragged || !target) return undefined;

  if (folioNodeHolds(dragged, targetId)) return undefined;

  if (position === "inside") {
    // Dropping "inside" only means something on a directory; a folio or
    // protected folio cannot hold children.
    if (target.kind !== "directory") return undefined;
    if (target.id === dragged.parentId) return undefined;
    return { parentId: target.id };
  }

  if (target.parentId === dragged.parentId) return undefined;
  return { parentId: target.parentId };
};
