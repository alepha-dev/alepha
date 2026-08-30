import { AlephaError } from "alepha";

import type { ImportIssue, ImportRow } from "../../schemas/questImportRow.ts";

export type ParseRowResult =
  | { ok: true; row: ImportRow; warnings: ImportIssue[] }
  | { ok: false; error: ImportIssue };

/**
 * Parser for CSV produced by Alepha Lore's own export.
 *
 * Recognized by `canParse(header)` returning true when the header contains
 * `shortId`, `title`, and `priority` (the three columns Alepha-Lore exports
 * unconditionally). Per-row, returns an `ImportRow` with `writeMode = upsert`
 * when `shortId` is set, else `create`.
 *
 * Undoes the export's CSV-injection guard: one leading apostrophe comes back
 * off every cell, so a title of `=HYPERLINK(...)`, exported as
 * `'=HYPERLINK(...)`, re-imports as itself. A value already opening on an
 * apostrophe was doubled on the way out, so it survives the same strip.
 */
export class AlephaLoreParser {
  public canParse(header: string[]): boolean {
    return (
      header.includes("shortId") &&
      header.includes("title") &&
      header.includes("priority")
    );
  }

  public parseRow(
    header: string[],
    cells: string[],
    rowIndex: number,
  ): ParseRowResult {
    const at = (name: string): string => {
      const i = header.indexOf(name);
      if (i < 0 || i >= cells.length) return "";
      const cell = cells[i].trim();
      // `QuestCsvFormatter.neutralize` is the other half of this: it prefixes
      // an apostrophe onto anything a spreadsheet would evaluate, and onto an
      // apostrophe itself, so dropping exactly one here is its inverse.
      return cell.startsWith("'") ? cell.slice(1) : cell;
    };

    const title = at("title");
    if (!title) {
      return {
        ok: false,
        error: { row: rowIndex, message: "Missing required field: title" },
      };
    }

    const shortId = at("shortId");
    const objectivesRaw = at("objectives");
    let objectives: ImportRow["objectives"] = [];
    if (objectivesRaw.length > 0) {
      try {
        const parsed = JSON.parse(objectivesRaw);
        if (!Array.isArray(parsed)) throw new AlephaError("not an array");
        objectives = parsed.map(
          (o: { title?: unknown; completed?: unknown }) => ({
            // Coercion at a boundary: the value is a form/route/chart primitive whose
            // declared type is wider than what can reach here.
            // oxlint-disable-next-line typescript/no-base-to-string
            title: String(o.title ?? ""),
            completed: Boolean(o.completed),
          }),
        );
      } catch (err) {
        return {
          ok: false,
          error: {
            row: rowIndex,
            message: `Malformed objectives JSON: ${(err as Error).message}`,
          },
        };
      }
    }

    const priority = (at("priority") || "medium") as ImportRow["priority"];

    // Export writes the ordinal, so import reads one. Anything absent, empty
    // or off the 1-5 scale lands on 3 (M) instead of failing the row: a CSV
    // taken before the column existed has to keep importing, and one bad
    // cell is not worth rejecting a whole quest over.
    const sizeCell = Number.parseInt(at("size"), 10);
    const size =
      Number.isInteger(sizeCell) && sizeCell >= 1 && sizeCell <= 5
        ? sizeCell
        : 3;

    const row: ImportRow = {
      rowIndex,
      writeMode: shortId ? "upsert" : "create",
      shortId,
      title,
      description: at("description"),
      // Accepts the retired `zone` header as well as `area`. Export writes
      // `area` only, so this is a one-way ramp for CSVs produced before the
      // rename — a file someone exported last week should not fail to import
      // this week, and silently dropping the column would be worse than
      // failing. Removable once no pre-rename export is plausibly still in
      // circulation.
      area: at("area") || at("zone"),
      priority,
      size,
      // A `difficulty` header is accepted and ignored: the mechanic was
      // erased, but a CSV exported before that must still round-trip.
      // Same one-way ramp as the retired `zone` header above.
      kanbanColumn: at("kanbanColumn"),
      release: at("release"),
      createdBy: at("createdBy"),
      acceptedBy: at("acceptedBy"),
      completedBy: at("completedBy"),
      createdAt: at("createdAt"),
      acceptedAt: at("acceptedAt"),
      completedAt: at("completedAt"),
      objectives,
    };
    return { ok: true, row, warnings: [] };
  }
}
