import { describe, it } from "vitest";

import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";
import {
  folioCellText,
  folioDecodeTableSnapshot,
  folioRangeToTsv,
  folioTsvToRange,
  folioVisibleRows,
} from "./folioTableModel.ts";

const columns: FolioColumnResource[] = [
  { id: "n", position: 0, name: "Name", type: "text", options: {} },
  {
    id: "s",
    position: 1,
    name: "Status",
    type: "select",
    options: {
      choices: [
        { id: "o", label: "Open" },
        { id: "d", label: "Done" },
      ],
    },
  },
  { id: "p", position: 2, name: "Price", type: "number", options: {} },
];

const row = (
  number: number,
  cells: Record<string, string | number | null>,
): FolioRowResource => ({
  id: `r${number}`,
  number,
  position: number,
  version: 0,
  cells,
  createdAt: "",
  updatedAt: "",
});

describe("folioTableModel", () => {
  const rows = [
    row(1, { n: "Fly", s: "d", p: 5 }),
    row(2, { n: "render", s: "o", p: null }),
    row(3, { n: "Hetzner", s: null, p: 4 }),
  ];

  it("reads a select by its label", ({ expect }) => {
    expect(folioCellText(columns[1], "d")).toBe("Done");
    expect(folioCellText(columns[1], "gone")).toBe("");
  });

  it("finds text in any cell, a select by its label", ({ expect }) => {
    expect(
      folioVisibleRows(columns, rows, { q: "done" }).map((r) => r.number),
    ).toEqual([1]);
    expect(
      folioVisibleRows(columns, rows, { q: "R" }).map((r) => r.number),
    ).toEqual([2, 3]);
  });

  it("sorts with empty cells last in either direction", ({ expect }) => {
    expect(
      folioVisibleRows(columns, rows, { sort: "p" }).map((r) => r.number),
    ).toEqual([3, 1, 2]);
    expect(
      folioVisibleRows(columns, rows, { sort: "p", dir: "desc" }).map(
        (r) => r.number,
      ),
    ).toEqual([1, 3, 2]);
    expect(
      folioVisibleRows(columns, rows, { sort: "s" }).map((r) => r.number),
    ).toEqual([2, 1, 3]);
  });

  it("round-trips a range through tab-separated text", ({ expect }) => {
    const range = [
      ["a", "b\tc"],
      ['say "hi"', "line\nbreak"],
    ];
    expect(folioTsvToRange(folioRangeToTsv(range))).toEqual(range);
    expect(folioTsvToRange("x\ty\r\n1\t2\n")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });

  it("decodes a snapshot leniently, and refuses one it cannot read", ({
    expect,
  }) => {
    expect(folioDecodeTableSnapshot("{bad")).toBeUndefined();
    expect(
      folioDecodeTableSnapshot(JSON.stringify({ v: 1, tooLarge: true })),
    ).toBeUndefined();
    const decoded = folioDecodeTableSnapshot(
      JSON.stringify({
        v: 1,
        columns: [{ id: "c", position: 0, name: "A", type: "weird" }],
        rows: [{ id: "r", number: 4, position: 1, cells: { c: "x", z: 1 } }],
      }),
    )!;
    expect(decoded.columns[0].type).toBe("text");
    expect(decoded.rows[0].cells).toEqual({ c: "x" });
  });
});
