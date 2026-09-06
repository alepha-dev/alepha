import {
  buildTree,
  findNode,
  flattenTree,
  type TreeDropPosition,
  type TreeNode,
  type TreeRow,
} from "@alepha/ui/components/tree-view/tree-model.ts";

/**
 * Lore's adapter over the shared tree model in `@alepha/ui`. The algorithms
 * (cycle breaking, flattening, drop resolution) live there; this file is the
 * translation from Lore's two lists and Lore's vocabulary (`title`,
 * `directoryId`) into the model's one flat list.
 */

/**
 * What a tree row represents. `protected` is a folio whose content is a
 * client-side crypto envelope: it gets a padlock instead of a page icon and a
 * different context menu.
 */
export type FolioTreeKind = "directory" | "folio" | "protected";

/**
 * The payload every folio tree node carries.
 */
export interface FolioTreeData {
  kind: FolioTreeKind;
  shortId: number;
  pinned?: boolean;
}

/**
 * `data` is narrowed to required here (the model declares it optional,
 * because a tree of bare names is legal) so no Lore call site has to write
 * `node.data?.kind`.
 */
export interface FolioTreeNode extends TreeNode<FolioTreeData> {
  data: FolioTreeData;
  children?: FolioTreeNode[];
}

export interface FolioTreeRow extends TreeRow<FolioTreeData> {
  node: FolioTreeNode;
}

export type FolioDropPosition = TreeDropPosition;

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
 * Assemble the directory and folio lists the route loader provides into one
 * nested tree. Directories sort before folios at every level, each group
 * alphabetically, which is the model's default order and the same ordering
 * the server uses, so the tree does not jump after a save.
 */
export const buildFolioTree = (input: BuildFolioTreeInput): FolioTreeNode[] =>
  buildTree<FolioTreeData>([
    ...input.directories.map((d) => ({
      id: d.id,
      name: d.name,
      parentId: d.parentId,
      branch: true,
      data: { kind: "directory" as const, shortId: d.shortId },
    })),
    ...input.folios.map((f) => ({
      id: f.id,
      name: f.title,
      parentId: f.directoryId,
      branch: false,
      data: {
        kind: (f.protected ? "protected" : "folio") as FolioTreeKind,
        shortId: f.shortId,
        pinned: f.pinned,
      },
    })),
  ]) as FolioTreeNode[];

/**
 * `flattenTree` and `findNode` with `data` narrowed back to required. The
 * cast is sound because `buildFolioTree` sets `data` on every item it builds.
 */
export const flattenFolioTree = (
  nodes: FolioTreeNode[],
  collapsed: ReadonlySet<string>,
): FolioTreeRow[] => flattenTree(nodes, collapsed) as FolioTreeRow[];

export const findFolioNode = (
  nodes: FolioTreeNode[],
  id: string,
): FolioTreeNode | undefined =>
  findNode(nodes, id) as FolioTreeNode | undefined;

/**
 * The model's node with `data` narrowed back to required, for the render
 * slots `TreeView` hands a `TreeNode<FolioTreeData>`.
 *
 * Sound because every node the tree can hand back came out of
 * `buildFolioTree`, which sets `data` on every item it builds. A helper
 * rather than a cast per slot, so there is one place to read the reason.
 */
export const asFolioNode = (node: TreeNode<FolioTreeData>): FolioTreeNode =>
  node as FolioTreeNode;
