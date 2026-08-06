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
 * Assemble the directory + folio lists the route loader provides into one
 * nested tree. Directories sort before folios at every level, each group
 * alphabetically — the same ordering the server uses, so the tree does not
 * jump after a save.
 *
 * A folio pointing at a directory that is not in the list (stale atom,
 * concurrent delete) falls back to the root rather than disappearing — same
 * treatment for a directory whose declared parent is missing.
 */
export const buildFolioTree = (input: BuildFolioTreeInput): FolioTreeNode[] => {
  const directoryIds = new Set(input.directories.map((d) => d.id));

  const childrenByParent = new Map<string, FolioTreeNode[]>();
  const childrenOf = (key: string): FolioTreeNode[] => {
    const existing = childrenByParent.get(key);
    if (existing) return existing;
    const created: FolioTreeNode[] = [];
    childrenByParent.set(key, created);
    return created;
  };

  for (const d of input.directories) {
    const parentId =
      d.parentId && directoryIds.has(d.parentId) ? d.parentId : undefined;
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
