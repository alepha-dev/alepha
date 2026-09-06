import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { describe, expect, it } from "vitest";

import { buildTree, flattenTree, type TreeItem } from "../tree-model.ts";
import { TreeViewRow } from "../tree-view-row.tsx";
import { TreeView } from "../tree-view.tsx";

const ITEMS: TreeItem[] = [
  { id: "d-0", name: "Level0", branch: true },
  { id: "d-1", name: "Level1", branch: true, parentId: "d-0" },
  { id: "d-2", name: "Level2", branch: true, parentId: "d-1" },
  { id: "leaf", name: "Leaf", branch: false, parentId: "d-2" },
  { id: "other", name: "Other", branch: true },
];

const NODES = buildTree(ITEMS);

interface HarnessProps {
  /**
   * Called once per row render, so a case can prove the memo held.
   */
  onRenderRow?: (id: string) => void;
  initialCollapsed?: string[];
  selectedId?: string;
}

/**
 * A consumer that passes INLINE arrows for every slot, which is the shape the
 * facade exists to survive. A harness holding `useCallback` everywhere would
 * prove the memo works for a consumer that did not need it.
 */
const Harness = (props: HarnessProps): ReactElement => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    new Set(props.initialCollapsed ?? []),
  );
  return (
    <TreeView
      label="Files"
      rows={flattenTree(NODES, collapsed)}
      collapsed={collapsed}
      selectedId={props.selectedId}
      onSelect={() => {}}
      onToggle={(id) => {
        const next = new Set(collapsed);
        if (!next.delete(id)) next.add(id);
        setCollapsed(next);
      }}
      renderLabel={(node) => {
        props.onRenderRow?.(node.id);
        return node.name;
      }}
    />
  );
};

const rowOf = (label: string): HTMLElement => {
  const row = screen
    .getByText(label)
    .closest('[data-slot="tree-view-row"]') as HTMLElement | null;
  expect(row, `row for ${label}`).not.toBeNull();
  return row as HTMLElement;
};

const px = (value: string): number => Number.parseFloat(value || "0");

describe("TreeView", () => {
  it("renders one row per visible row, in order", () => {
    render(<Harness />);
    const rows = document.querySelectorAll('[data-slot="tree-view-row"]');
    expect([...rows].map((r) => r.textContent)).toEqual([
      "Level0",
      "Level1",
      "Level2",
      "Leaf",
      "Other",
    ]);
  });

  it("speaks the tree structure: roles, level, expanded and selected", () => {
    render(<Harness selectedId="d-1" initialCollapsed={["d-2"]} />);

    expect(screen.getByRole("tree", { name: "Files" })).toBeTruthy();

    // aria-level is 1-based, and the flat equivalent of nested role="group".
    expect(rowOf("Level0").getAttribute("aria-level")).toBe("1");
    expect(rowOf("Level1").getAttribute("aria-level")).toBe("2");
    expect(rowOf("Level2").getAttribute("aria-level")).toBe("3");

    expect(rowOf("Level0").getAttribute("aria-expanded")).toBe("true");
    expect(rowOf("Level2").getAttribute("aria-expanded")).toBe("false");

    expect(rowOf("Level1").getAttribute("aria-selected")).toBe("true");
    expect(rowOf("Level1").getAttribute("data-selected")).toBe("true");
    expect(rowOf("Level0").getAttribute("aria-selected")).toBeNull();
    expect(rowOf("Level0").getAttribute("data-selected")).toBeNull();
  });

  it("gives a leaf no aria-expanded and no chevron", () => {
    render(<Harness />);

    // A leaf cannot hold children, so there is nothing to expand and
    // nothing to say about it.
    expect(rowOf("Leaf").getAttribute("aria-expanded")).toBeNull();
    expect(rowOf("Leaf").querySelector("button")).toBeNull();
    expect(rowOf("Level0").querySelector("button")).toBeTruthy();

    // The disclosure column still takes its width, so labels line up.
    const spacer = rowOf("Leaf").querySelector("span") as HTMLElement;
    expect(px(spacer.style.width)).toBe(14);
  });

  it("indents by depth and paints one guide per ancestor level", () => {
    render(<Harness />);

    const box = px(
      (rowOf("Level0").querySelector("button") as HTMLElement).style.width,
    );
    expect(box, "the disclosure column's width").toBe(14);

    const base = px(rowOf("Level0").style.paddingLeft);
    expect(base, "a depth-0 row's padding").toBe(8);

    // A root-level row has nothing to guide back to.
    expect(rowOf("Level0").style.backgroundImage).toBe("");

    const expectedOrigin = base + box / 2;

    for (const [depth, label] of [
      [1, "Level1"],
      [2, "Level2"],
      [3, "Leaf"],
    ] as const) {
      const row = rowOf(label);
      expect(px(row.style.paddingLeft), `depth ${depth} padding`).toBe(
        8 + depth * 13,
      );

      // The guides are one repeating gradient clipped to the indent area,
      // so "how many" is the width it is allowed to paint over.
      expect(row.style.backgroundImage).toContain("repeating-linear-gradient");
      // From the theme's border token, never a literal.
      expect(row.style.backgroundImage).toContain("var(--border)");
      expect(row.style.backgroundSize, `depth ${depth} guide count`).toBe(
        `${depth * 13}px 100%`,
      );

      const [originX] = row.style.backgroundPosition.split(" ");
      // Every depth paints from the SAME origin: the guides repeat, they do
      // not restart per row, and that origin is the centre of a depth-0
      // disclosure column.
      expect(px(originX), `depth ${depth} guide origin`).toBe(expectedOrigin);

      // Which is what makes the k-th line land on the k-th ancestor's
      // chevron: origin + k*step === (8 + k*step) + box/2, for every k.
      for (let k = 0; k < depth; k++) {
        expect(
          px(originX) + k * 13,
          `guide ${k} under a depth-${depth} row`,
        ).toBe(8 + k * 13 + box / 2);
      }
    }
  });

  it("transitions only colour and transform, never all", () => {
    // The row is also a drag source that carries the drop markers, so a
    // blanket transition would put the drop indicator on a timer.
    render(<Harness />);
    const row = rowOf("Level0");
    expect(row.className).toContain("transition-[background-color,transform]");
    expect(row.className).not.toContain("transition-all");
    expect(row.className).toContain("active:translate-y-px");
  });

  it("collapses on a chevron click and expands again on the next", () => {
    render(<Harness />);

    const chevron = rowOf("Level0").querySelector("button") as HTMLElement;
    fireEvent.click(chevron);
    expect(screen.queryByText("Level1")).toBeNull();

    fireEvent.click(rowOf("Level0").querySelector("button") as HTMLElement);
    expect(screen.getByText("Level1")).toBeTruthy();
  });

  it("does not toggle twice on a double click", () => {
    // A real double click fires click, click, dblclick. Without the
    // `e.detail > 1` guard the two clicks toggle the branch twice and it
    // ends collapsed, a different outcome from the single click that shares
    // its first half.
    render(<Harness />);

    fireEvent.click(rowOf("Level0"), { detail: 1 });
    fireEvent.click(rowOf("Level0"), { detail: 2 });

    expect(screen.getByText("Level1")).toBeTruthy();
  });

  it("selects on Enter and on Space", () => {
    const selected: string[] = [];
    render(
      <TreeView
        label="Files"
        rows={flattenTree(NODES, new Set())}
        collapsed={new Set()}
        onSelect={(node) => selected.push(node.id)}
        onToggle={() => {}}
      />,
    );

    fireEvent.keyDown(rowOf("Leaf"), { key: "Enter" });
    fireEvent.keyDown(rowOf("Leaf"), { key: " " });
    fireEvent.keyDown(rowOf("Leaf"), { key: "a" });

    expect(selected).toEqual(["leaf", "leaf"]);
  });

  it("exports a memoised row", () => {
    expect((TreeViewRow as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  it("does not re-render an unaffected sibling when a branch toggles", () => {
    // The point of the facade: the harness passes inline arrows, so every
    // callback identity changes on the toggle, and the memo must still hold
    // for the rows whose own props did not change.
    const renders: string[] = [];
    render(<Harness onRenderRow={(id) => renders.push(id)} />);

    renders.length = 0;
    fireEvent.click(rowOf("Level0").querySelector("button") as HTMLElement);

    // Level0 itself re-renders (its collapsed flag flipped) and the rows
    // beneath it disappear. "Other" is untouched by any of that.
    expect(renders).toContain("d-0");
    expect(renders).not.toContain("other");
  });
});
