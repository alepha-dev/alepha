import { describe, expect, it } from "vitest";

import {
  buildTree,
  findNode,
  flattenTree,
  nodeHolds,
  resolveDrop,
  type TreeItem,
  type TreeNode,
} from "../tree-model.ts";

const branch = (
  id: string,
  name: string,
  parentId?: string,
): TreeItem<undefined> => ({ id, name, parentId, branch: true });

const leaf = (
  id: string,
  name: string,
  parentId?: string,
): TreeItem<undefined> => ({ id, name, parentId, branch: false });

const fixture = () =>
  buildTree([
    branch("d-arch", "architecture"),
    branch("d-product", "product"),
    branch("d-sub", "sub", "d-product"),
    leaf("f-runtime", "Runtime lifecycle", "d-arch"),
    leaf("f-folio", "Folio module", "d-product"),
    leaf("f-deep", "Deep note", "d-sub"),
    leaf("f-conv", "Conventions"),
    leaf("f-keys", "Deploy keys"),
  ]);

describe("buildTree", () => {
  it("nests branches and leaves, branches first, each sorted by name", () => {
    const tree = fixture();
    expect(tree.map((n) => n.name)).toEqual([
      "architecture",
      "product",
      "Conventions",
      "Deploy keys",
    ]);
  });

  it("carries the payload through onto the node", () => {
    const tree = buildTree<{ pinned: boolean }>([
      {
        id: "f-conv",
        name: "Conventions",
        branch: false,
        data: { pinned: true },
      },
    ]);
    expect(findNode(tree, "f-conv")?.data).toEqual({ pinned: true });
  });

  it("gives every branch a children array and every leaf none", () => {
    const tree = buildTree([branch("d-empty", "empty"), leaf("f-1", "one")]);
    expect(findNode(tree, "d-empty")?.children).toEqual([]);
    expect(findNode(tree, "f-1")?.children).toBeUndefined();
  });

  it("takes a comparator over the default order", () => {
    const tree = buildTree(
      [branch("d-z", "zulu"), leaf("f-a", "alpha")],
      (a, b) => a.name.localeCompare(b.name),
    );
    expect(tree.map((n) => n.id)).toEqual(["f-a", "d-z"]);
  });

  it("drops a leaf whose parent does not exist to the root", () => {
    const tree = buildTree([leaf("f-x", "Orphan", "gone")]);
    expect(tree.map((n) => n.id)).toEqual(["f-x"]);
  });

  it("drops a leaf parented on another leaf to the root", () => {
    // A leaf cannot hold children, so naming one as a parent is the same
    // failure as naming nothing at all.
    const tree = buildTree([leaf("f-a", "a"), leaf("f-b", "b", "f-a")]);
    expect(tree.map((n) => n.id)).toEqual(["f-a", "f-b"]);
    expect(findNode(tree, "f-b")?.parentId).toBeUndefined();
  });

  it("drops a branch whose parent does not exist to the root", () => {
    const tree = buildTree([branch("d-x", "Orphan dir", "missing")]);
    expect(tree.map((n) => n.id)).toEqual(["d-x"]);
    expect(tree[0].parentId).toBeUndefined();
  });

  it("drops a branch parented on a leaf to the root", () => {
    const tree = buildTree([leaf("f-a", "a"), branch("d-b", "b", "f-a")]);
    expect(findNode(tree, "d-b")?.parentId).toBeUndefined();
    expect(tree.map((n) => n.id)).toEqual(["d-b", "f-a"]);
  });

  it("keeps two branches with the same name at different depths distinct", () => {
    const tree = buildTree([
      branch("d-1", "notes"),
      branch("d-2", "notes", "d-1"),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["d-1"]);
    expect(tree[0].children?.map((n) => n.id)).toEqual(["d-2"]);
    expect(findNode(tree, "d-2")?.name).toBe("notes");
  });

  it("keeps a branch and a leaf with the same name as siblings, branch first", () => {
    const tree = buildTree([
      branch("d-1", "Same name"),
      leaf("f-1", "Same name"),
    ]);
    expect(tree.map((n) => [n.id, n.branch])).toEqual([
      ["d-1", true],
      ["f-1", false],
    ]);
  });

  it("returns an empty tree for an empty input", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("buildTree - parent cycles", () => {
  // A branch's `parentId` chain can cycle: a server that guards against a
  // direct cycle usually does it as two separate, non-atomic round-trips,
  // and two clients each reading pre-move state can each pass that check
  // independently and together still produce
  // `A.parentId === B.id && B.parentId === A.id`. A chain that revisits a
  // node can never be walked to root, so it gets the same fallback as a
  // parent id that does not exist at all: root, not vanish.

  it("falls back a self-parenting branch to the root; a leaf filed there is still reachable", () => {
    const tree = buildTree([
      branch("c", "self", "c"),
      leaf("f-in-c", "in c", "c"),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["c"]);
    expect(tree[0].parentId).toBeUndefined();
    expect(tree[0].children?.map((n) => n.id)).toEqual(["f-in-c"]);
  });

  it("cuts a two-branch parent cycle at one member, keeping the other nested under it", () => {
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      leaf("f-in-a", "in a", "A"),
    ]);
    // A is encountered first (input order), so A is the member promoted to
    // root; B keeps its own declared parent (A) rather than also moving.
    expect(tree.map((n) => n.id)).toEqual(["A"]);
    expect(tree[0].parentId).toBeUndefined();
    expect(findNode(tree, "B")?.parentId).toBe("A");
    expect(findNode(tree, "f-in-a")?.parentId).toBe("A");
  });

  it("cuts a three-branch parent cycle at the first-encountered member, chaining the rest beneath it", () => {
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "C"),
      branch("C", "c", "A"),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["A"]);
    expect(findNode(tree, "A")?.parentId).toBeUndefined();
    expect(findNode(tree, "C")?.parentId).toBe("A");
    expect(findNode(tree, "B")?.parentId).toBe("C");
  });

  it("keeps a leaf filed under a cyclic branch reachable at its declared position", () => {
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      branch("C", "c", "C"),
      leaf("f1", "one", "A"),
      leaf("f2", "two", "C"),
    ]);
    expect(findNode(tree, "f1")?.parentId).toBe("A");
    expect(findNode(tree, "f2")?.parentId).toBe("C");
  });

  it("surfaces every input node exactly once, whatever the parent ids say", () => {
    const items = [
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      branch("C", "c", "C"),
      branch("D", "d", "missing"),
      branch("E", "e"),
      leaf("f1", "one", "A"),
      leaf("f2", "two", "C"),
      leaf("f3", "three", "gone"),
      leaf("f4", "four"),
    ];
    const rows = flattenTree(buildTree(items), new Set());
    expect(rows.map((r) => r.node.id).sort()).toEqual(
      items.map((i) => i.id).sort(),
    );
  });

  it("locates every node with findNode that flattenTree also sees, even with a cycle in the input", () => {
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      leaf("f-in-a", "in a", "A"),
    ]);
    const rows = flattenTree(tree, new Set());
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(findNode(tree, row.node.id)).toBe(row.node);
    }
  });
});

describe("buildTree - declaredParentId distinguishes a promoted node from a genuine root", () => {
  it("sets declaredParentId to the true cyclic parent on the promoted node only", () => {
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      branch("E", "e"),
    ]);
    const a = findNode(tree, "A") as TreeNode;
    const b = findNode(tree, "B") as TreeNode;
    const e = findNode(tree, "E") as TreeNode;

    // A and E both show parentId: undefined in the tree, indistinguishable
    // by parentId alone, but only A's is a rewrite. declaredParentId is
    // how a consumer tells them apart without re-running cycle detection.
    expect(a.parentId).toBeUndefined();
    expect(e.parentId).toBeUndefined();
    expect(a.declaredParentId).toBe("B");
    expect(e.declaredParentId).toBeUndefined();
    // B's own parentId was never rewritten: it already matches what B's
    // record declares, so it carries no declaredParentId either.
    expect(b.declaredParentId).toBeUndefined();
  });

  it("leaves declaredParentId unset for an orphan (missing parent), not just for a genuine root", () => {
    // A missing parent and a cyclic parent both fall back to root, but they
    // are different failure modes: an orphan's own declared parent is
    // simply gone (no id to recover), so there is nothing meaningful for
    // declaredParentId to carry. Only cycle-breaking rewrites a parent that
    // was otherwise a valid, existing branch.
    const tree = buildTree([branch("D", "d", "missing")]);
    expect(findNode(tree, "D")?.declaredParentId).toBeUndefined();
  });
});

describe("resolveDrop - cycle-promoted nodes", () => {
  it("resolves a drag-to-root for a cycle-promoted node to the repair write, not a no-op", () => {
    // A's tree parentId is already undefined (root) because the cycle got
    // broken here, but A's stored record still declares parentId "B", which
    // is exactly what declaredParentId carries. A genuinely-root node
    // (f-conv) has neither parentId nor declaredParentId set. Dragging A
    // next to f-conv resolves the same new-parent value either way
    // (f-conv's tree parentId, undefined); the decision this test pins is
    // the no-op check: it must compare against A's true stored parent
    // ("B"), not its rewritten tree parentId ("undefined"), or this exact
    // drag, the one that actually clears the corruption by writing
    // `{ parentId: undefined }`, would read as "nothing changed" (since
    // undefined === undefined) and get silently dropped, along with every
    // other legal destination for A.
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      leaf("f-conv", "Conventions"),
    ]);
    expect(resolveDrop(tree, "A", "f-conv", "before")).toEqual({
      parentId: undefined,
    });
  });

  it("still treats a genuinely-root node next to another genuinely-root node as a no-op", () => {
    // Regression check: the declaredParentId-aware comparison must not
    // turn ordinary root-to-root reorders into writes. Neither node here
    // was ever rewritten, so declaredParentId is unset on both and the
    // check falls back to comparing parentId as before.
    const tree = buildTree([
      leaf("f-conv", "Conventions"),
      leaf("f-keys", "Deploy keys"),
    ]);
    expect(resolveDrop(tree, "f-conv", "f-keys", "before")).toBeUndefined();
  });

  it("resolves a genuine move (not to root) for a cycle-promoted node normally", () => {
    // Dragging the promoted node into an unrelated, ordinary branch is
    // unaffected by declaredParentId: the target side of the comparison
    // never involves it, only the dragged side does.
    const tree = buildTree([
      branch("A", "a", "B"),
      branch("B", "b", "A"),
      branch("d-arch", "architecture"),
    ]);
    expect(resolveDrop(tree, "A", "d-arch", "inside")).toEqual({
      parentId: "d-arch",
    });
  });
});

describe("flattenTree", () => {
  it("emits every node with its depth when nothing is collapsed", () => {
    const rows = flattenTree(fixture(), new Set());
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

  it("hides the whole subtree of a collapsed branch", () => {
    const rows = flattenTree(fixture(), new Set(["d-product"]));
    expect(rows.map((r) => r.node.id)).toEqual([
      "d-arch",
      "f-runtime",
      "d-product",
      "f-conv",
      "f-keys",
    ]);
  });

  it("ignores a collapsed id that is not in the tree", () => {
    const rows = flattenTree(fixture(), new Set(["does-not-exist"]));
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
    expect(flattenTree([], new Set())).toEqual([]);
  });
});

describe("nodeHolds", () => {
  it("is true for the node itself", () => {
    const product = findNode(fixture(), "d-product") as TreeNode;
    expect(nodeHolds(product, "d-product")).toBe(true);
  });

  it("is true for a nested descendant", () => {
    const product = findNode(fixture(), "d-product") as TreeNode;
    expect(nodeHolds(product, "f-deep")).toBe(true);
  });

  it("is false for an unrelated node", () => {
    const product = findNode(fixture(), "d-product") as TreeNode;
    expect(nodeHolds(product, "f-runtime")).toBe(false);
  });
});

describe("resolveDrop", () => {
  it("resolves an 'inside' drop on a branch to that branch", () => {
    expect(resolveDrop(fixture(), "f-conv", "d-arch", "inside")).toEqual({
      parentId: "d-arch",
    });
  });

  it("resolves 'before' and 'after' to the target's parent, not a position", () => {
    expect(resolveDrop(fixture(), "f-conv", "f-deep", "before")).toEqual({
      parentId: "d-sub",
    });
    expect(resolveDrop(fixture(), "f-conv", "f-deep", "after")).toEqual({
      parentId: "d-sub",
    });
  });

  it("resolves a drop next to a root node to the tree root", () => {
    expect(resolveDrop(fixture(), "f-deep", "f-conv", "after")).toEqual({
      parentId: undefined,
    });
  });

  it("refuses to drop a node on itself", () => {
    expect(
      resolveDrop(fixture(), "f-conv", "f-conv", "inside"),
    ).toBeUndefined();
  });

  it("refuses to drop a branch into its own subtree", () => {
    expect(
      resolveDrop(fixture(), "d-product", "f-deep", "inside"),
    ).toBeUndefined();
    expect(
      resolveDrop(fixture(), "d-product", "d-sub", "inside"),
    ).toBeUndefined();
  });

  it("refuses a move that would not change the parent", () => {
    expect(resolveDrop(fixture(), "f-deep", "d-sub", "inside")).toBeUndefined();
  });

  it("refuses an 'inside' drop on a leaf", () => {
    expect(
      resolveDrop(fixture(), "f-conv", "f-runtime", "inside"),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(resolveDrop(fixture(), "nope", "d-arch", "inside")).toBeUndefined();
  });

  it("refuses a 'before'/'after' drop of a branch next to its own direct child", () => {
    // f-folio's parent is d-product; dropping d-product "after" its own
    // child f-folio would resolve to parentId: "d-product", d-product
    // reparented under itself.
    expect(
      resolveDrop(fixture(), "d-product", "f-folio", "after"),
    ).toBeUndefined();
  });

  it("refuses a 'before'/'after' drop of a branch next to a deeper descendant", () => {
    // f-deep sits two levels inside d-product (via d-sub); dropping
    // d-product next to it would orphan the branch it is itself part of.
    expect(
      resolveDrop(fixture(), "d-product", "f-deep", "before"),
    ).toBeUndefined();
  });

  it("distinguishes a no-op sibling reorder from a genuine move", () => {
    // f-conv and f-keys are both already root siblings: the parent does not
    // change, so this must be a no-op even though the ids differ.
    expect(
      resolveDrop(fixture(), "f-conv", "f-keys", "before"),
    ).toBeUndefined();
    // Moving f-conv next to f-runtime does change its parent (root to
    // d-arch).
    expect(resolveDrop(fixture(), "f-conv", "f-runtime", "before")).toEqual({
      parentId: "d-arch",
    });
  });
});
