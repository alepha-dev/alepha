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
      return i < 0 || i >= cells.length ? "" : cells[i].trim();
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
        if (!Array.isArray(parsed)) throw new Error("not an array");
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
      // A `difficulty` header is accepted and ignored: the mechanic was
      // erased, but a CSV exported before that must still round-trip.
      // Same one-way ramp as the retired `zone` header above.
      kanbanColumn: at("kanbanColumn"),
      milestone: at("milestone"),
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
