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
    const difficultyRaw = at("difficulty");
    const difficulty = Number.parseInt(difficultyRaw || "1", 10);
    if (Number.isNaN(difficulty) || difficulty < 1 || difficulty > 5) {
      return {
        ok: false,
        error: {
          row: rowIndex,
          message: `Invalid difficulty: ${difficultyRaw} (must be 1-5)`,
        },
      };
    }

    const row: ImportRow = {
      rowIndex,
      writeMode: shortId ? "upsert" : "create",
      shortId,
      title,
      description: at("description"),
      zone: at("zone"),
      priority,
      difficulty,
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
