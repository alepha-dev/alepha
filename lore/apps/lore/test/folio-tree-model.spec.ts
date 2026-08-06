import { describe, expect, it } from "vitest";
import {
  buildFolioTree,
  findFolioNode,
  flattenFolioTree,
  folioNodeHolds,
  resolveFolioDrop,
} from "@/web/app/components/folios/editor/tree/folioTreeModel.ts";

const fixture = () =>
  buildFolioTree({
    directories: [
      { id: "d-arch", name: "architecture", shortId: 1 },
      { id: "d-product", name: "product", shortId: 2 },
      { id: "d-sub", name: "sub", shortId: 3, parentId: "d-product" },
    ],
    folios: [
      {
        id: "f-runtime",
        title: "Runtime lifecycle",
        shortId: 10,
        directoryId: "d-arch",
      },
      {
        id: "f-folio",
        title: "Folio module",
        shortId: 11,
        directoryId: "d-product",
      },
      { id: "f-deep", title: "Deep note", shortId: 12, directoryId: "d-sub" },
      { id: "f-conv", title: "Conventions", shortId: 13, pinned: true },
      { id: "f-keys", title: "Deploy keys", shortId: 14, protected: true },
    ],
  });

describe("buildFolioTree", () => {
  it("nests directories and files, directories first, each sorted by name", () => {
    const tree = fixture();
    expect(tree.map((n) => n.name)).toEqual([
      "architecture",
      "product",
      "Conventions",
      "Deploy keys",
    ]);
  });

  it("marks a protected folio with its own kind", () => {
    const tree = fixture();
    expect(findFolioNode(tree, "f-keys")?.kind).toBe("protected");
    expect(findFolioNode(tree, "f-conv")?.kind).toBe("folio");
  });

  it("carries the pinned flag through", () => {
    expect(findFolioNode(fixture(), "f-conv")?.pinned).toBe(true);
  });

  it("drops a folio whose directory does not exist to the root", () => {
    const tree = buildFolioTree({
      directories: [],
      folios: [{ id: "f-x", title: "Orphan", shortId: 1, directoryId: "gone" }],
    });
    expect(tree.map((n) => n.id)).toEqual(["f-x"]);
  });

  it("drops a directory whose parent does not exist to the root", () => {
    const tree = buildFolioTree({
      directories: [
        { id: "d-x", name: "Orphan dir", shortId: 1, parentId: "missing" },
      ],
      folios: [],
    });
    expect(tree.map((n) => n.id)).toEqual(["d-x"]);
    expect(tree[0].parentId).toBeUndefined();
  });

  it("keeps two directories with the same name at different depths distinct", () => {
    const tree = buildFolioTree({
      directories: [
        { id: "d-1", name: "notes", shortId: 1 },
        { id: "d-2", name: "notes", shortId: 2, parentId: "d-1" },
      ],
      folios: [],
    });
    expect(tree.map((n) => n.id)).toEqual(["d-1"]);
    expect(tree[0].children?.map((n) => n.id)).toEqual(["d-2"]);
    expect(findFolioNode(tree, "d-2")?.name).toBe("notes");
  });

  it("keeps a directory and a folio with the same name as siblings, directory first", () => {
    const tree = buildFolioTree({
      directories: [{ id: "d-1", name: "Same name", shortId: 1 }],
      folios: [{ id: "f-1", title: "Same name", shortId: 2 }],
    });
    expect(tree.map((n) => [n.id, n.kind])).toEqual([
      ["d-1", "directory"],
      ["f-1", "folio"],
    ]);
  });

  it("returns an empty tree for an empty project", () => {
    expect(buildFolioTree({ directories: [], folios: [] })).toEqual([]);
  });
});

describe("buildFolioTree — parent cycles", () => {
  // A directory's `parentId` chain can cycle: `FolioDirectoryService.move()`
  // guards against a direct cycle server-side, but as two separate,
  // non-atomic round-trips — two clients each reading pre-move state can
  // each pass that check independently and together still produce
  // `A.parentId === B.id && B.parentId === A.id`. A chain that revisits a
  // node can never be walked to root, so it gets the same fallback as a
  // parent id that does not exist at all: root, not vanish.

  it("falls back a self-parenting directory to the root; a folio filed there is still reachable", () => {
    const tree = buildFolioTree({
      directories: [{ id: "c", name: "self", shortId: 1, parentId: "c" }],
      folios: [{ id: "f-in-c", title: "in c", shortId: 10, directoryId: "c" }],
    });
    expect(tree.map((n) => n.id)).toEqual(["c"]);
    expect(tree[0].parentId).toBeUndefined();
    expect(tree[0].children?.map((n) => n.id)).toEqual(["f-in-c"]);
  });

  it("cuts a two-directory parent cycle at one member, keeping the other nested under it", () => {
    const tree = buildFolioTree({
      directories: [
        { id: "A", name: "a", shortId: 1, parentId: "B" },
        { id: "B", name: "b", shortId: 2, parentId: "A" },
      ],
      folios: [{ id: "f-in-a", title: "in a", shortId: 10, directoryId: "A" }],
    });
    // A is encountered first (input order), so A is the member promoted to
    // root; B keeps its own declared parent (A) rather than also moving.
    expect(tree.map((n) => n.id)).toEqual(["A"]);
    expect(tree[0].parentId).toBeUndefined();
    expect(findFolioNode(tree, "B")?.parentId).toBe("A");
    expect(findFolioNode(tree, "f-in-a")?.parentId).toBe("A");
  });

  it("cuts a three-directory parent cycle at the first-encountered member, chaining the rest beneath it", () => {
    const tree = buildFolioTree({
      directories: [
        { id: "A", name: "a", shortId: 1, parentId: "B" },
        { id: "B", name: "b", shortId: 2, parentId: "C" },
        { id: "C", name: "c", shortId: 3, parentId: "A" },
      ],
      folios: [],
    });
    expect(tree.map((n) => n.id)).toEqual(["A"]);
    expect(findFolioNode(tree, "A")?.parentId).toBeUndefined();
    expect(findFolioNode(tree, "C")?.parentId).toBe("A");
    expect(findFolioNode(tree, "B")?.parentId).toBe("C");
  });

  it("keeps a folio filed under a cyclic directory reachable at its declared position", () => {
    const directories = [
      { id: "A", name: "a", shortId: 1, parentId: "B" },
      { id: "B", name: "b", shortId: 2, parentId: "A" },
      { id: "C", name: "c", shortId: 3, parentId: "C" },
    ];
    const folios = [
      { id: "f1", title: "one", shortId: 10, directoryId: "A" },
      { id: "f2", title: "two", shortId: 11, directoryId: "C" },
    ];
    const tree = buildFolioTree({ directories, folios });
    expect(findFolioNode(tree, "f1")?.parentId).toBe("A");
    expect(findFolioNode(tree, "f2")?.parentId).toBe("C");
  });

  it("surfaces every input node exactly once, whatever the parent ids say", () => {
    const directories = [
      { id: "A", name: "a", shortId: 1, parentId: "B" },
      { id: "B", name: "b", shortId: 2, parentId: "A" },
      { id: "C", name: "c", shortId: 3, parentId: "C" },
      { id: "D", name: "d", shortId: 4, parentId: "missing" },
      { id: "E", name: "e", shortId: 5 },
    ];
    const folios = [
      { id: "f1", title: "one", shortId: 10, directoryId: "A" },
      { id: "f2", title: "two", shortId: 11, directoryId: "C" },
      { id: "f3", title: "three", shortId: 12, directoryId: "gone" },
      { id: "f4", title: "four", shortId: 13 },
    ];
    const rows = flattenFolioTree(
      buildFolioTree({ directories, folios }),
      new Set(),
    );
    const ids = rows.map((r) => r.node.id).sort();
    expect(ids).toEqual(
      [...directories.map((d) => d.id), ...folios.map((f) => f.id)].sort(),
    );
  });

  it("locates every node with findFolioNode that flattenFolioTree also sees, even with a cycle in the input", () => {
    const directories = [
      { id: "A", name: "a", shortId: 1, parentId: "B" },
      { id: "B", name: "b", shortId: 2, parentId: "A" },
    ];
    const folios = [
      { id: "f-in-a", title: "in a", shortId: 10, directoryId: "A" },
    ];
    const tree = buildFolioTree({ directories, folios });
    const rows = flattenFolioTree(tree, new Set());
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(findFolioNode(tree, row.node.id)).toBe(row.node);
    }
  });
});

describe("flattenFolioTree", () => {
  it("emits every node with its depth when nothing is collapsed", () => {
    const rows = flattenFolioTree(fixture(), new Set());
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ["d-arch", 0],
      ["f-runtime", 1],
      ["d-product", 0],
      ["d-sub", 1],
      ["f-deep", 2],
      ["f-folio", 1],
      ["f-conv", 0],
      ["f-keys", 0],
    ]);
  });

  it("hides the whole subtree of a collapsed directory", () => {
    const rows = flattenFolioTree(fixture(), new Set(["d-product"]));
    expect(rows.map((r) => r.node.id)).toEqual([
      "d-arch",
      "f-runtime",
      "d-product",
      "f-conv",
      "f-keys",
    ]);
  });

  it("ignores a collapsed id that is not in the tree", () => {
    const rows = flattenFolioTree(fixture(), new Set(["does-not-exist"]));
    expect(rows.map((r) => r.node.id)).toEqual([
      "d-arch",
      "f-runtime",
      "d-product",
      "d-sub",
      "f-deep",
      "f-folio",
      "f-conv",
      "f-keys",
    ]);
  });

  it("returns an empty list for an empty tree", () => {
    expect(flattenFolioTree([], new Set())).toEqual([]);
  });
});

describe("folioNodeHolds", () => {
  it("is true for the node itself", () => {
    const product = findFolioNode(fixture(), "d-product")!;
    expect(folioNodeHolds(product, "d-product")).toBe(true);
  });

  it("is true for a nested descendant", () => {
    const product = findFolioNode(fixture(), "d-product")!;
    expect(folioNodeHolds(product, "f-deep")).toBe(true);
  });

  it("is false for an unrelated node", () => {
    const product = findFolioNode(fixture(), "d-product")!;
    expect(folioNodeHolds(product, "f-runtime")).toBe(false);
  });
});

describe("resolveFolioDrop", () => {
  it("resolves an 'inside' drop on a directory to that directory", () => {
    expect(resolveFolioDrop(fixture(), "f-conv", "d-arch", "inside")).toEqual({
      parentId: "d-arch",
    });
  });

  it("resolves 'before' and 'after' to the target's parent, not a position", () => {
    expect(resolveFolioDrop(fixture(), "f-conv", "f-deep", "before")).toEqual({
      parentId: "d-sub",
    });
    expect(resolveFolioDrop(fixture(), "f-conv", "f-deep", "after")).toEqual({
      parentId: "d-sub",
    });
  });

  it("resolves a drop next to a root node to the project root", () => {
    expect(resolveFolioDrop(fixture(), "f-deep", "f-conv", "after")).toEqual({
      parentId: undefined,
    });
  });

  it("refuses to drop a node on itself", () => {
    expect(
      resolveFolioDrop(fixture(), "f-conv", "f-conv", "inside"),
    ).toBeUndefined();
  });

  it("refuses to drop a directory into its own subtree", () => {
    expect(
      resolveFolioDrop(fixture(), "d-product", "f-deep", "inside"),
    ).toBeUndefined();
    expect(
      resolveFolioDrop(fixture(), "d-product", "d-sub", "inside"),
    ).toBeUndefined();
  });

  it("refuses a move that would not change the parent", () => {
    expect(
      resolveFolioDrop(fixture(), "f-deep", "d-sub", "inside"),
    ).toBeUndefined();
  });

  it("refuses an 'inside' drop on a folio", () => {
    expect(
      resolveFolioDrop(fixture(), "f-conv", "f-runtime", "inside"),
    ).toBeUndefined();
  });

  it("refuses an 'inside' drop on a protected folio", () => {
    expect(
      resolveFolioDrop(fixture(), "f-conv", "f-keys", "inside"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(
      resolveFolioDrop(fixture(), "nope", "d-arch", "inside"),
    ).toBeUndefined();
  });

  it("refuses a 'before'/'after' drop of a directory next to its own direct child", () => {
    // f-folio's parent is d-product; dropping d-product "after" its own
    // child f-folio would resolve to parentId: "d-product" — d-product
    // reparented under itself.
    expect(
      resolveFolioDrop(fixture(), "d-product", "f-folio", "after"),
    ).toBeUndefined();
  });

  it("refuses a 'before'/'after' drop of a directory next to a deeper descendant", () => {
    // f-deep sits two levels inside d-product (via d-sub); dropping d-product
    // next to it would orphan the branch it is itself part of.
    expect(
      resolveFolioDrop(fixture(), "d-product", "f-deep", "before"),
    ).toBeUndefined();
  });

  it("distinguishes a no-op sibling reorder from a genuine move", () => {
    // f-conv and f-keys are both already root siblings — the parent does not
    // change, so this must be a no-op even though the ids differ.
    expect(
      resolveFolioDrop(fixture(), "f-conv", "f-keys", "before"),
    ).toBeUndefined();
    // Moving f-conv next to f-runtime does change its parent (root -> d-arch).
    expect(
      resolveFolioDrop(fixture(), "f-conv", "f-runtime", "before"),
    ).toEqual({
      parentId: "d-arch",
    });
  });
});
