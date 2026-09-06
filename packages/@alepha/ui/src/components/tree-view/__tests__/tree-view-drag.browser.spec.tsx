import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  buildTree,
  flattenTree,
  type TreeDropPosition,
  type TreeItem,
} from "../tree-model.ts";
import { TreeView } from "../tree-view.tsx";

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
  effectAllowed?: string;
  setData?: () => void;
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

  it("splits a branch row into three zones", () => {
    const seen: [string, TreeDropPosition][] = [];
    render(
      <Harness dragId="leaf" onDragOver={(id, p) => seen.push([id, p])} />,
    );

    // 28% / 44% / 28% of a 20px row: before under 5.6, after over 14.4.
    dragOver(rowOf("Branch"), 2);
    dragOver(rowOf("Branch"), 10);
    dragOver(rowOf("Branch"), 18);

    expect(seen).toEqual([
      ["d-0", "before"],
      ["d-0", "inside"],
      ["d-0", "after"],
    ]);
  });

  it("splits a leaf row into two, with no inside zone", () => {
    // A leaf cannot hold children, so there is nothing an inside drop could
    // mean on one.
    const seen: TreeDropPosition[] = [];
    render(<Harness dragId="d-0" onDragOver={(_, p) => seen.push(p)} />);

    dragOver(rowOf("Leaf"), 2);
    dragOver(rowOf("Leaf"), 10);
    dragOver(rowOf("Leaf"), 18);

    expect(seen).toEqual(["before", "after", "after"]);
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

  it("reports nothing for the row being dragged onto itself", () => {
    const seen: string[] = [];
    render(<Harness dragId="d-0" onDragOver={(id) => seen.push(id)} />);

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

  it("marks the dragged row and draws the drop marker where the drop is", () => {
    const { rerender } = render(
      <Harness dragId="leaf" drop={{ id: "d-0", position: "inside" }} />,
    );

    // A transform on a drag source moves the browser's own drag image with
    // it, so the press is suppressed for exactly as long as the drag lasts.
    expect(rowOf("Leaf").className).toContain("opacity-45");
    expect(rowOf("Leaf").className).not.toContain("active:translate-y-px");
    expect(rowOf("Branch").className).toContain("ring-inset");

    rerender(
      <Harness dragId="leaf" drop={{ id: "d-0", position: "before" }} />,
    );
    expect(
      rowOf("Branch").querySelector('[data-slot="tree-view-drop-before"]'),
    ).toBeTruthy();
    expect(rowOf("Branch").className).not.toContain("ring-inset");

    rerender(<Harness dragId="leaf" drop={{ id: "d-0", position: "after" }} />);
    expect(
      rowOf("Branch").querySelector('[data-slot="tree-view-drop-after"]'),
    ).toBeTruthy();
  });
});
