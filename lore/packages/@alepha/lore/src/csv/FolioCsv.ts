/**
 * One column of a table folio, as CSV reads and writes it.
 */
export interface FolioCsvColumn {
  id: string;
  name: string;
  type: string;
  options?: {
    choices?: Array<{ id: string; label: string }>;
    withTime?: boolean;
  };
}

/**
 * The column types a CSV column can be guessed as.
 */
export type FolioCsvGuess = "number" | "date" | "checkbox" | "text";

/**
 * CSV in and out of a table folio: the exchange format, never the storage.
 *
 * One module for the three places a table meets a file: the API, the
 * browser (import and export) and the `lore` CLI (`lore folio import` /
 * `export`), so a file exported by one imports unchanged by the others. It
 * imports nothing, and runs in a browser, in Node and in a Worker.
 *
 * - **Parsing** follows RFC 4180: quoted fields, embedded newlines and
 *   doubled quotes. The separator (comma, semicolon or tab) is detected on
 *   the first line, and a UTF-8 byte order mark is dropped.
 * - **Writing** quotes a field only when it must, ends lines with CRLF, and
 *   starts with a byte order mark so a spreadsheet opens accents correctly.
 * - **Cells** go out as stored: a select by its label, a reference by its
 *   code (`#Q12`), a date as ISO, a checkbox as `true` / `false`.
 */
export class FolioCsv {
  static readonly BOM = "﻿";

  /**
   * The rows of a CSV text, each a list of fields, and the separator found.
   * A trailing empty line is not a row.
   */
  public parse(text: string): { rows: string[][]; separator: string } {
    const body = text.startsWith(FolioCsv.BOM) ? text.slice(1) : text;
    const separator = this.detectSeparator(body);
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    let i = 0;
    while (i < body.length) {
      const char = body[i];
      if (quoted) {
        if (char === '"') {
          if (body[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i += 1;
          continue;
        }
        field += char;
        i += 1;
        continue;
      }
      if (char === '"' && field === "") {
        quoted = true;
        i += 1;
        continue;
      }
      if (char === separator) {
        row.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (char === "\r" || char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += char === "\r" && body[i + 1] === "\n" ? 2 : 1;
        continue;
      }
      field += char;
      i += 1;
    }
    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return { rows, separator };
  }

  /**
   * Rows of fields as CSV text, comma-separated, CRLF line ends, with a
   * byte order mark unless `bom` is false.
   */
  public serialize(rows: string[][], opts: { bom?: boolean } = {}): string {
    const lines = rows.map((row) =>
      row.map((field) => this.quote(field)).join(","),
    );
    return `${opts.bom === false ? "" : FolioCsv.BOM}${lines.join("\r\n")}\r\n`;
  }

  /**
   * A table as CSV: a header line of column names, then every row in the
   * order given, each cell as stored.
   */
  public fromTable(input: {
    columns: FolioCsvColumn[];
    rows: Array<{ cells: Record<string, unknown> }>;
  }): string {
    return this.serialize([
      input.columns.map((column) => column.name),
      ...input.rows.map((row) =>
        input.columns.map((column) =>
          this.cellText(column, row.cells[column.id]),
        ),
      ),
    ]);
  }

  /**
   * One cell as CSV text: a select by its label, everything else as its
   * stored value, empty for nothing.
   */
  public cellText(column: FolioCsvColumn, value: unknown): string {
    if (value === null || value === undefined) return "";
    if (column.type === "select") {
      const choice = column.options?.choices?.find((it) => it.id === value);
      return choice?.label ?? "";
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    return JSON.stringify(value);
  }

  /**
   * The type a column's values suggest: `number` when every non-empty value
   * is one, `date` when every one is a day or an ISO datetime, `checkbox`
   * when every one is `true` or `false`, otherwise `text`. A column with
   * no value at all is `text`.
   */
  public guessType(values: string[]): FolioCsvGuess {
    const present = values.map((value) => value.trim()).filter(Boolean);
    if (present.length === 0) return "text";
    if (present.every((value) => /^(true|false)$/i.test(value))) {
      return "checkbox";
    }
    if (
      present.every((value) => value !== "" && Number.isFinite(Number(value)))
    ) {
      return "number";
    }
    if (
      present.every((value) =>
        /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(
          value,
        ),
      )
    ) {
      return "date";
    }
    return "text";
  }

  /**
   * Whether a guessed date column carries times.
   */
  public hasTime(values: string[]): boolean {
    return values.some((value) => value.includes("T"));
  }

  /**
   * The separator of a CSV text: whichever of comma, semicolon and tab
   * occurs most on its first line outside quotes; comma on a tie or none.
   */
  protected detectSeparator(text: string): string {
    const counts = new Map<string, number>([
      [",", 0],
      [";", 0],
      ["\t", 0],
    ]);
    let quoted = false;
    for (const char of text) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && (char === "\n" || char === "\r")) break;
      else if (!quoted && counts.has(char)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    let best = ",";
    for (const [char, count] of counts) {
      if (count > (counts.get(best) ?? 0)) best = char;
    }
    return best;
  }

  protected quote(field: string): string {
    return /[",\r\n]|^\s|\s$/.test(field)
      ? `"${field.replace(/"/g, '""')}"`
      : field;
  }
}
