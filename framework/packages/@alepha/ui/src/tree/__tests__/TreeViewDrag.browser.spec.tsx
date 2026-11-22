import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  buildTree,
  flattenTree,
  type TreeDropPosition,
  type TreeItem,
} from "../treeModel.ts";
import { TreeView } from "../TreeView.tsx";

const ITEMS: TreeItem[] = [
  { id: "d-0", name: "Branch", branch: true },
  { id: "leaf", name: "Leaf", branch: false },
];

const NODES = buildTree(ITEMS);

const ROW_HEIGHT = 20;

interface HarnessProps {
  draggable?: boolean;
  dragId?: string;
  onDragOver?: (id: string, position: TreeDropPosition) => void;
  onDragStart?: (id: string) => void;
  onDrop?: (id: string) => void;
  drop?: { id: string; position: TreeDropPosition };
}

const Harness = (props: HarnessProps): ReactElement => (
  <TreeView
    label="Files"
    rows={flattenTree(NODES, new Set())}
    collapsed={new Set()}
    onSelect={() => {}}
    onToggle={() => {}}
    draggable={props.draggable ?? true}
    dragId={props.dragId}
    drop={props.drop}
    onDragStart={props.onDragStart}
    onDragOver={props.onDragOver}
    onDrop={props.onDrop}
    onDragEnd={() => {}}
  />
);

const rowOf = (label: string): HTMLElement => {
  const row = screen
    .getByText(label)
    .closest('[data-slot="tree-view-row"]') as HTMLElement;
  expect(row, `row for ${label}`).not.toBeNull();
  return row;
};

/**
 * ⚠️ Two things jsdom cannot do on its own, and both have to be supplied here
 * or the zone arithmetic is measuring nothing.
 *
 * It lays nothing out, so every element is a zero-sized box: the rect is
 * stubbed, and the assertions are on the resolved position, never on pixels.
 *
 * And it implements no `DragEvent`, so `fireEvent.dragOver` falls back to a
 * plain `Event` and silently drops `clientY` - which reads as `NaN` in the
 * handler and lands every drag in the middle zone whatever the coordinate.
 * A `MouseEvent` named `dragover` carries the coordinate and reaches React's
 * `onDragOver` exactly the same way.
 */
const ROW_RECT = { top: 0, height: ROW_HEIGHT } as DOMRect;

interface FakeDataTransfer {
  types: string[];
  dropEffect: string;
  files?: File[];
  effectAllowed?: string;
  setData?: () => void;
  setDragImage?: (element: HTMLElement) => void;
}

const dispatchDrag = (
  row: HTMLElement,
  type: "dragover" | "drop" | "dragstart",
  clientY: number,
  dataTransfer: FakeDataTransfer,
): void => {
  row.getBoundingClientRect = () => ROW_RECT;
  const event = new MouseEvent(type, {
    clientY,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(row, event);
};

const dragOver = (
  row: HTMLElement,
  clientY: number,
  types: string[] = [],
): FakeDataTransfer => {
  const dataTransfer: FakeDataTransfer = { types, dropEffect: "" };
  dispatchDrag(row, "dragover", clientY, dataTransfer);
  return dataTransfer;
};

describe("TreeView drag and drop", () => {
  it("attaches no drag handler when the capability is off", () => {
    const seen: string[] = [];
    render(
      <Harness
        draggable={false}
        dragId="leaf"
        onDragOver={(id) => seen.push(id)}
      />,
    );

    expect(rowOf("Branch").getAttribute("draggable")).toBe("false");
    dragOver(rowOf("Branch"), 10);
    expect(seen).toEqual([]);
  });

  it("names a folder: a branch row itself, a leaf row its folder", () => {
    // One zone per row: the tree is sorted, so there is no place
    // between two rows to report, only the folder a drop lands in.
    const seen: [string, TreeDropPosition][] = [];
    render(
      <Harness dragId="leaf" onDragOver={(id, p) => seen.push([id, p])} />,
    );

    dragOver(rowOf("Branch"), 2);
    dragOver(rowOf("Branch"), 18);
    dragOver(rowOf("Leaf"), 10);

    expect(seen).toEqual([
      ["d-0", "inside"],
      ["d-0", "inside"],
      ["leaf", "before"],
    ]);
  });

  it("refuses an OS file drag rather than treating it as a re-parent", () => {
    const seen: string[] = [];
    render(<Harness dragId="leaf" onDragOver={(id) => seen.push(id)} />);

    // `dataTransfer.files` is empty until `drop`, so `types` is the only
    // readable signal during `dragover`.
    const dataTransfer = dragOver(rowOf("Branch"), 10, ["Files"]);

    expect(dataTransfer.dropEffect).toBe("none");
    expect(seen).toEqual([]);
  });

  it("reports nothing while no row of this tree is being dragged", () => {
    // An external drag carrying no files leaves `dragId` unset, and so does
    // the frame before an internal drag's `dragstart` state lands.
    const seen: string[] = [];
    render(<Harness onDragOver={(id) => seen.push(id)} />);

    dragOver(rowOf("Branch"), 10);
    expect(seen).toEqual([]);
  });

  it("announces the drag and drops on the row under the pointer", () => {
    const started: string[] = [];
    const dropped: string[] = [];
    render(
      <Harness
        dragId="leaf"
        onDragStart={(id) => started.push(id)}
        onDrop={(id) => dropped.push(id)}
      />,
    );

    dispatchDrag(rowOf("Leaf"), "dragstart", 0, {
      types: [],
      dropEffect: "",
      effectAllowed: "",
      setData: () => {},
    });
    dispatchDrag(rowOf("Branch"), "drop", 10, { types: [], dropEffect: "" });

    expect(started).toEqual(["leaf"]);
    expect(dropped).toEqual(["d-0"]);
  });

  it("does not drop an OS file drag", () => {
    const dropped: string[] = [];
    render(<Harness dragId="leaf" onDrop={(id) => dropped.push(id)} />);

    dispatchDrag(rowOf("Branch"), "drop", 10, {
      types: ["Files"],
      dropEffect: "",
    });
    expect(dropped).toEqual([]);
  });

  it("takes OS files on a row when the consumer accepts them", () => {
    const received: Array<[string, string[]]> = [];
    render(
      <TreeView
        label="Files"
        rows={flattenTree(NODES, new Set())}
        collapsed={new Set()}
        onSelect={() => {}}
        onToggle={() => {}}
        draggable
        onDrop={() => {}}
        onFilesDrop={(id, files) =>
          received.push([id, files.map((file) => file.name)])
        }
      />,
    );

    const over = dragOver(rowOf("Branch"), 10, ["Files"]);
    expect(over.dropEffect).toBe("copy");

    const file = new File(["a,b"], "budget.csv", { type: "text/csv" });
    dispatchDrag(rowOf("Branch"), "drop", 10, {
      types: ["Files"],
      dropEffect: "",
      files: [file],
    } as FakeDataTransfer);
    expect(received).toEqual([["d-0", ["budget.csv"]]]);
  });

  const NESTED = buildTree([
    { id: "d-0", name: "Branch", branch: true },
    { id: "a", name: "Alpha", branch: false, parentId: "d-0" },
    { id: "b", name: "Bravo", branch: false, parentId: "d-0" },
    { id: "top", name: "Top", branch: false },
  ]);

  const Nested = (props: {
    dragId?: string;
    drop?: { id: string; position: TreeDropPosition };
    collapsed?: Set<string>;
    onToggle?: (id: string) => void;
  }): ReactElement => (
    <TreeView
      label="Files"
      rows={flattenTree(NESTED, props.collapsed ?? new Set())}
      collapsed={props.collapsed ?? new Set()}
      onSelect={() => {}}
      onToggle={props.onToggle ?? (() => {})}
      draggable
      dragId={props.dragId}
      drop={props.drop}
      onDragOver={() => {}}
    />
  );

  it("refuses with the no-drop cursor a drop into the item's own folder", () => {
    // The lie this replaced: a line between two siblings promised a place,
    // and the sort put the item straight back.
    render(<Nested dragId="a" />);

    expect(dragOver(rowOf("Bravo"), 10).dropEffect).toBe("none");
    expect(dragOver(rowOf("Branch"), 10).dropEffect).toBe("none");
    expect(dragOver(rowOf("Top"), 10).dropEffect).toBe("move");
  });

  it("refuses a branch dropped on itself or inside its own subtree", () => {
    render(<Nested dragId="d-0" />);

    expect(dragOver(rowOf("Branch"), 10).dropEffect).toBe("none");
    expect(dragOver(rowOf("Alpha"), 10).dropEffect).toBe("none");
  });

  it("lights the target folder's whole block, and draws no line", () => {
    render(<Nested dragId="top" drop={{ id: "b", position: "before" }} />);

    // Over a file in Branch: Branch is the target, so its row and its rows.
    for (const label of ["Branch", "Alpha", "Bravo"]) {
      expect(rowOf(label).className).toContain("bg-primary/15");
    }
    expect(rowOf("Top").className).not.toContain("bg-primary/15");
    // The dragged row is dimmed, and its press suppressed: a transform on a
    // drag source moves the browser's own drag image with it.
    expect(rowOf("Top").className).toContain("opacity-45");
    expect(rowOf("Top").className).not.toContain("active:translate-y-px");
    expect(
      document.querySelector(
        '[data-slot="tree-view-drop-before"], [data-slot="tree-view-drop-after"]',
      ),
    ).toBeNull();
  });

  it("lights nothing where the drop would do nothing", () => {
    // A branch inside its own subtree, and a file over its own folder.
    const { rerender } = render(
      <Nested dragId="d-0" drop={{ id: "a", position: "before" }} />,
    );
    expect(rowOf("Branch").className).not.toContain("bg-primary/15");

    rerender(<Nested dragId="a" drop={{ id: "b", position: "before" }} />);
    expect(rowOf("Branch").className).not.toContain("bg-primary/15");
  });

  it("flags the root as the target for a root-level file", () => {
    render(<Nested dragId="a" drop={{ id: "top", position: "before" }} />);

    expect(screen.getByRole("tree").hasAttribute("data-drop-root")).toBe(true);
  });

  it("opens a closed folder held under the pointer", async () => {
    const toggled: string[] = [];
    render(
      <Nested
        dragId="top"
        drop={{ id: "d-0", position: "inside" }}
        collapsed={new Set(["d-0"])}
        onToggle={(id) => toggled.push(id)}
      />,
    );

    expect(toggled).toEqual([]);
    await waitFor(() => expect(toggled).toEqual(["d-0"]), { timeout: 2000 });
  });

  it("drags a compact label of the name, not the whole row", () => {
    const images: string[] = [];
    render(<Harness dragId={undefined} />);

    dispatchDrag(rowOf("Leaf"), "dragstart", 0, {
      types: [],
      dropEffect: "",
      effectAllowed: "",
      setData: () => {},
      setDragImage: (element: HTMLElement) =>
        images.push(element.textContent ?? ""),
    } as FakeDataTransfer);

    expect(images).toEqual(["Leaf"]);
  });
});
