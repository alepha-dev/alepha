import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, describe, expect, it } from "vitest";

import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";
// Imported at the top of the spec, not lazily: the document loads the grid
// as a lazy chunk, and a jsdom waitFor races a chunk still loading.
import FolioTableGrid, { type FolioTableGridProps } from "./FolioTableGrid.tsx";

const columns: FolioColumnResource[] = [
  { id: "n", position: 0, name: "Name", type: "text", options: {} },
  { id: "d", position: 1, name: "Done", type: "checkbox", options: {} },
  { id: "p", position: 2, name: "Price", type: "number", options: {} },
];

const rowsOf = (count: number): FolioRowResource[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    number: i + 1,
    position: i + 1,
    version: 0,
    cells: { n: `Row ${i + 1}`, d: i % 2 === 0, p: i },
    createdAt: "",
    updatedAt: "",
  }));

/**
 * The grid (#Q3516): keyboard, editing, clipboard, virtualisation and the
 * read-only member.
 */
describe("FolioTableGrid", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (props: Partial<FolioTableGridProps> = {}) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    const calls = {
      write: [] as Array<[number, string, string]>,
      paste: [] as Array<[number, number, string[][]]>,
      clear: [] as Array<Array<{ number: number; columnIds: string[] }>>,
    };
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <FolioTableGrid
          columns={columns}
          rows={rowsOf(3)}
          readOnly={false}
          conflicts={[]}
          renderHeader={(column) => <span>{column.name}</span>}
          onWriteCell={(row, columnId, text) =>
            calls.write.push([row.number, columnId, text])
          }
          onPaste={(r, c, range) => calls.paste.push([r, c, range])}
          onClear={(cells) =>
            calls.clear.push(
              cells.map((it) => ({
                number: it.row.number,
                columnIds: it.columnIds,
              })),
            )
          }
          onInsertBelow={() => {}}
          onDeleteRows={() => {}}
          onMoveRow={() => {}}
          {...props}
        />
      </AlephaContext.Provider>,
    );
    const grid = screen.getByRole("grid");
    return { view, grid, calls };
  };

  const focusedCell = () =>
    document.querySelector<HTMLElement>("[role=gridcell].ring-2");

  it("moves with the arrows and Tab, and selects a range with Shift", async () => {
    const { grid } = await mount();
    grid.focus();
    fireEvent.focus(grid);
    expect(focusedCell()?.textContent).toBe("Row 1");

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(focusedCell()?.textContent).toBe("Row 2");
    fireEvent.keyDown(grid, { key: "Tab" });
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(focusedCell()?.getAttribute("data-column-id")).toBe("p");
    fireEvent.keyDown(grid, { key: "ArrowUp", shiftKey: true });
    expect(
      document.querySelectorAll("[role=gridcell][aria-selected=true]"),
    ).toHaveLength(2);
  });

  it("edits with Enter, commits with Enter and moves down", async () => {
    const { grid, calls } = await mount();
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    const input = screen.getByTestId("folio-cell-editor") as HTMLInputElement;
    expect(input.value).toBe("Row 1");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.write).toEqual([[1, "n", "Renamed"]]);
    expect(focusedCell()?.textContent).toBe("Row 2");
  });

  it("cancels with Escape, writing nothing", async () => {
    const { grid, calls } = await mount();
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    const input = screen.getByTestId("folio-cell-editor");
    fireEvent.change(input, { target: { value: "Lost" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("folio-cell-editor")).toBeNull();
    expect(calls.write).toEqual([]);
  });

  it("starts editing with the character typed on a focused cell", async () => {
    const { grid } = await mount();
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "x" });
    const input = screen.getByTestId("folio-cell-editor") as HTMLInputElement;
    expect(input.value).toBe("x");
  });

  it("opens a date cell's picker on a typed key, never with the key as its value", async () => {
    const { grid, calls } = await mount({
      columns: [
        { id: "d", position: 0, name: "Due", type: "date", options: {} },
      ],
      rows: rowsOf(1).map((row) => ({ ...row, cells: { d: "2026-11-20" } })),
    });
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "2" });
    expect(screen.getByTestId("folio-cell-editor").textContent).toMatch(
      /2026|Nov/,
    );
    expect(calls.write).toEqual([]);
  });

  it("puts the keyboard on a select's or a date's control when it opens", async () => {
    const { grid } = await mount({
      columns: [
        {
          id: "s",
          position: 0,
          name: "Owner",
          type: "select",
          options: { choices: [{ id: "a", label: "Ana" }] },
        },
        { id: "d", position: 1, name: "Due", type: "date", options: {} },
      ],
      rows: rowsOf(1).map((row) => ({ ...row, cells: {} })),
    });
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    const editor = screen.getByTestId("folio-cell-editor");
    expect(editor.closest(".w-full")?.contains(document.activeElement)).toBe(
      true,
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(
      screen
        .getByTestId("folio-cell-editor")
        .closest(".w-full")
        ?.contains(document.activeElement),
    ).toBe(true);
  });

  it("picks a select's option with Enter, and writes that option", async () => {
    const { grid, calls } = await mount({
      columns: [
        {
          id: "s",
          position: 0,
          name: "Owner",
          type: "select",
          options: {
            choices: [
              { id: "a", label: "Ana" },
              { id: "b", label: "Ben" },
            ],
          },
        },
      ],
      rows: rowsOf(1).map((row) => ({ ...row, cells: {} })),
    });
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    const option = await screen.findByRole("option", { name: "Ben" });
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() => expect(calls.write).toEqual([[1, "s", "Ben"]]));
  });

  it("toggles a checkbox with Space, and empties the selection with Delete", async () => {
    const { grid, calls } = await mount();
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: " " });
    expect(calls.write).toEqual([[1, "d", "false"]]);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(calls.clear).toEqual([
      [
        { number: 1, columnIds: ["d"] },
        { number: 2, columnIds: ["d"] },
      ],
    ]);
  });

  it("copies a range as tab-separated text, and pastes one at the focus", async () => {
    const { grid, calls } = await mount();
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    const written: Record<string, string> = {};
    fireEvent.copy(grid, {
      clipboardData: {
        setData: (type: string, value: string) => {
          written[type] = value;
        },
      },
    });
    expect(written["text/plain"]).toBe("Row 1\ttrue\t0\nRow 2\tfalse\t1");

    fireEvent.paste(grid, {
      clipboardData: { getData: () => "a\tb\nc\td" },
    });
    expect(calls.paste).toEqual([
      [
        0,
        0,
        [
          ["a", "b"],
          ["c", "d"],
        ],
      ],
    ]);
  });

  it("draws only the rows in view of a 2,000 row table", async () => {
    await mount({ rows: rowsOf(2000) });
    const drawn = document.querySelectorAll(
      "[data-slot=folio-grid-body] [role=row]",
    ).length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(60);
    expect(screen.getByRole("grid").getAttribute("aria-rowcount")).toBe("2001");
  });

  it("offers no editor, menu or drag handle to a reader", async () => {
    const { grid, calls } = await mount({ readOnly: true });
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "x" });
    expect(screen.queryByTestId("folio-cell-editor")).toBeNull();
    expect(document.querySelector("[draggable]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Row 1/ })).toBeNull();
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(calls.clear).toEqual([]);
  });
  it("offers the [[# picker's entries in a reference cell, and writes the pick", async () => {
    const { grid, calls } = await mount({
      columns: [
        { id: "r", position: 0, name: "See", type: "reference", options: {} },
      ],
      rows: rowsOf(1).map((row) => ({ ...row, cells: {} })),
      referenceSuggestions: [
        { token: "#F3", label: "Hosting decision" },
        { token: "#Q12", label: "Move the DNS" },
      ],
    });
    fireEvent.focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(
      await screen.findByRole("option", { name: "#F3 Hosting decision" }),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("option", { name: "#Q12 Move the DNS" }),
    );
    await waitFor(() => expect(calls.write).toEqual([[1, "r", "#Q12"]]));
  });
});
