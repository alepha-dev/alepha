import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTableSelection } from "../use-table-selection.ts";

interface Row {
  id: string;
  name: string;
}

const page1: Row[] = [
  { id: "1", name: "a" },
  { id: "2", name: "b" },
  { id: "3", name: "c" },
];
const page2: Row[] = [
  { id: "4", name: "d" },
  { id: "5", name: "e" },
  { id: "6", name: "f" },
];
const rowKey = (r: Row) => r.id;

const setup = (data: Row[] = page1) =>
  renderHook(({ rows }) => useTableSelection(rows, rowKey), {
    initialProps: { rows: data },
  });

describe("useTableSelection", () => {
  it("keeps selected items across page changes", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleRow(page1[0]));
    act(() => result.current.toggleRow(page1[1]));

    rerender({ rows: page2 });
    act(() => result.current.toggleRow(page2[0]));

    // The pill count and the items handed to bulk actions must agree:
    // 2 rows from page 1 + 1 row from page 2.
    expect(result.current.selection.size).toBe(3);
    expect(result.current.selectedItems.map(rowKey).sort()).toEqual([
      "1",
      "2",
      "4",
    ]);
  });

  it("toggleAll selects and deselects the current page only", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleRow(page1[0]));

    rerender({ rows: page2 });
    act(() => result.current.toggleAll());
    expect(result.current.selection.size).toBe(4);

    act(() => result.current.toggleAll());
    expect(result.current.selection.size).toBe(1);
    expect(result.current.selectedItems.map(rowKey)).toEqual(["1"]);
  });

  it("computes allSelected/someSelected against the current page", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleAll());
    expect(result.current.allSelected).toBe(true);
    expect(result.current.someSelected).toBe(false);

    rerender({ rows: page2 });
    expect(result.current.allSelected).toBe(false);
    expect(result.current.someSelected).toBe(false);

    act(() => result.current.toggleRow(page2[0]));
    expect(result.current.allSelected).toBe(false);
    expect(result.current.someSelected).toBe(true);
  });

  it("clearSelection empties every page's selection", () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleAll());
    rerender({ rows: page2 });
    act(() => result.current.toggleAll());
    expect(result.current.selection.size).toBe(6);

    act(() => result.current.clearSelection());
    expect(result.current.selection.size).toBe(0);
    expect(result.current.selectedItems).toEqual([]);
  });

  it("toggling a selected row removes it", () => {
    const { result } = setup();
    act(() => result.current.toggleRow(page1[0]));
    act(() => result.current.toggleRow(page1[0]));
    expect(result.current.selection.size).toBe(0);
  });
});
