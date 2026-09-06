import type { TreeItem } from "@alepha/ui/components/tree-view/tree-model.ts";

/**
 * What a node in these specimens carries beyond its name: a count for the
 * trailing slot, so the third slot has something to draw.
 */
export interface TreeSpecimenData {
  count?: number;
}

export type TreeSpecimenItem = TreeItem<TreeSpecimenData>;

/**
 * A tree that nests as deep as the knob asks.
 *
 * Depth is a knob because the indent guides are the detail most likely to
 * regress and the hardest to see at depth 1: one row of guides is a hairline
 * nobody would miss the absence of, and four rows are unmistakable.
 */
export const buildTreeItems = (depth: number): TreeSpecimenItem[] => {
  const items: TreeSpecimenItem[] = [
    { id: "src", name: "src", branch: true },
    { id: "empty", name: "empty", branch: true },
    { id: "readme", name: "README.md", branch: false, data: { count: 3 } },
    { id: "license", name: "LICENSE", branch: false },
  ];

  let parent = "src";
  for (let level = 1; level <= depth; level++) {
    const id = `level-${level}`;
    items.push({ id, name: `level ${level}`, branch: true, parentId: parent });
    items.push({
      id: `${id}-file`,
      name: `file-${level}.ts`,
      branch: false,
      parentId: id,
      data: { count: level },
    });
    parent = id;
  }

  return items;
};

/**
 * Apply a resolved parent change to the flat list.
 *
 * The model resolves a drop; writing it back is the consumer's, and for a
 * consumer whose store is an array in `useState` that is this one line.
 */
export const reparent = (
  items: TreeSpecimenItem[],
  id: string,
  parentId: string | undefined,
): TreeSpecimenItem[] =>
  items.map((item) => (item.id === id ? { ...item, parentId } : item));
