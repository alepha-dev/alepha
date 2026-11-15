import type { FolioCellValue } from "../../../../../../api/schemas/folioCellValueSchema.ts";
import type { FolioColumnResource } from "../../../../../../api/schemas/folioColumnResourceSchema.ts";
import type { FolioRowResource } from "../../../../../../api/schemas/folioRowResourceSchema.ts";

/**
 * The grid's pure half (#E144, #Q3516): how a cell reads, how the reader's
 * filter and sort apply, and how a range travels through the clipboard. No
 * React, so each rule is asserted on its own.
 */

/**
 * The reader's view of a table: a text that every row must contain in some
 * cell, and a sort. Kept in the URL, never stored: it is the reader's, not
 * the folio's.
 */
export interface FolioTableView {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
}

/**
 * A cell as the grid shows it: a select by its label, a checkbox as
 * nothing (the grid draws the box), a timed date in the reader's zone, a
 * day as written, anything else as its text.
 */
export const folioCellText = (
  column: FolioColumnResource,
  value: FolioCellValue,
  locale?: string,
): string => {
  if (value === null || value === undefined) return "";
  if (column.type === "select") {
    return (
      column.options.choices?.find((choice) => choice.id === value)?.label ?? ""
    );
  }
  if (column.type === "checkbox") return "";
  if (column.type === "date" && typeof value === "string") {
    if (value.length === 10) return value;
    const at = new Date(value);
    return Number.isNaN(at.getTime())
      ? value
      : at.toLocaleString(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        });
  }
  return String(value);
};

/**
 * The text a cell offers to an editor or the clipboard: a select by its
 * label, a checkbox as `true` / `false`, everything else as stored.
 */
export const folioCellEditText = (
  column: FolioColumnResource,
  value: FolioCellValue,
): string => {
  if (value === null || value === undefined) return "";
  if (column.type === "select") return folioCellText(column, value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

/**
 * The rows the reader sees: those holding `q` in some cell (without regard
 * to case), sorted by one column with empty cells last, ties in row order.
 */
export const folioVisibleRows = (
  columns: FolioColumnResource[],
  rows: FolioRowResource[],
  view: FolioTableView,
): FolioRowResource[] => {
  const needle = view.q?.trim().toLowerCase();
  let visible = needle
    ? rows.filter((row) =>
        columns.some((column) =>
          folioCellEditText(column, row.cells[column.id] ?? null)
            .toLowerCase()
            .includes(needle),
        ),
      )
    : [...rows];
  const column = view.sort
    ? columns.find((it) => it.id === view.sort)
    : undefined;
  if (column) {
    const flip = view.dir === "desc" ? -1 : 1;
    visible = visible.sort((a, b) => {
      const left = a.cells[column.id] ?? null;
      const right = b.cells[column.id] ?? null;
      if (left === null && right === null) return a.position - b.position;
      if (left === null) return 1;
      if (right === null) return -1;
      return (
        flip * folioCompareCells(column, left, right) || a.position - b.position
      );
    });
  } else {
    visible.sort((a, b) => a.position - b.position);
  }
  return visible;
};

/**
 * Two non-empty cells of one column, ascending: numbers as numbers, a
 * select in option order, text without regard to case, dates as ISO.
 */
export const folioCompareCells = (
  column: FolioColumnResource,
  a: FolioCellValue,
  b: FolioCellValue,
): number => {
  if (column.type === "number" || column.type === "checkbox") {
    return Number(a) - Number(b);
  }
  if (column.type === "select") {
    const choices = column.options.choices ?? [];
    return (
      choices.findIndex((choice) => choice.id === a) -
      choices.findIndex((choice) => choice.id === b)
    );
  }
  const left = String(a);
  const right = String(b);
  return column.type === "text"
    ? left.localeCompare(right, undefined, { sensitivity: "base" })
    : left < right
      ? -1
      : left > right
        ? 1
        : 0;
};

/**
 * A rectangular range as tab-separated text, the shape a spreadsheet copies
 * and pastes: one line per row, cells separated by tabs. A cell holding a
 * tab, a newline or a quote is quoted.
 */
export const folioRangeToTsv = (cells: string[][]): string =>
  cells
    .map((line) =>
      line
        .map((text) =>
          /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text,
        )
        .join("\t"),
    )
    .join("\n");

/**
 * Tab-separated text back into a range. A trailing line end is not a row.
 */
export const folioTsvToRange = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

/**
 * A revision's snapshot of a table, decoded leniently (#Q3513): `undefined`
 * when it does not read, never a throw.
 */
export const folioDecodeTableSnapshot = (
  raw: string,
): { columns: FolioColumnResource[]; rows: FolioRowResource[] } | undefined => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const value = data as {
    v?: number;
    columns?: unknown;
    rows?: unknown;
  } | null;
  if (
    !value ||
    value.v !== 1 ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.rows)
  ) {
    return undefined;
  }
  const types = new Set([
    "text",
    "number",
    "checkbox",
    "date",
    "select",
    "reference",
  ]);
  const columns = (value.columns as Array<Record<string, unknown>>)
    .filter(
      (it) => it && typeof it.id === "string" && typeof it.name === "string",
    )
    .map((it, index) => {
      const options = (it.options ?? {}) as FolioColumnResource["options"];
      return {
        id: it.id as string,
        position: typeof it.position === "number" ? it.position : index,
        name: it.name as string,
        type: (types.has(it.type as string)
          ? it.type
          : "text") as FolioColumnResource["type"],
        options: {
          ...(Array.isArray(options.choices)
            ? { choices: options.choices }
            : {}),
          ...(options.withTime ? { withTime: true } : {}),
        },
      };
    })
    .sort((a, b) => a.position - b.position);
  const rows = (value.rows as Array<Record<string, unknown>>)
    .filter((it) => it && typeof it.number === "number")
    .map((it) => ({
      id: String(it.id ?? it.number),
      number: it.number as number,
      position: typeof it.position === "number" ? it.position : 0,
      version: 0,
      cells: Object.fromEntries(
        columns.map((column) => {
          const raw = (it.cells as Record<string, unknown> | undefined)?.[
            column.id
          ];
          return [
            column.id,
            raw === undefined || (typeof raw === "object" && raw !== null)
              ? null
              : (raw as FolioCellValue),
          ];
        }),
      ),
      createdAt: "",
      updatedAt: "",
    }))
    .sort((a, b) => a.position - b.position);
  return { columns, rows };
};
