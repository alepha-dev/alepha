import type { ImportRow } from "../../schemas/questImportRow.ts";
import type { ParseRowResult } from "./AlephaLoreParser.ts";

/**
 * Parser for Trello's CSV board export.
 *
 * Trello columns we map:
 *   - `Card Name`        → `title` (required)
 *   - `Card Description` → `description`
 *   - `List`             → `zone`
 *   - `Members`          → `acceptedBy` (first member only; resolved by username)
 *
 * Trello columns we ignore: `Card ID`, `Card URL`, `Activity`, `Labels`,
 * `Due Date`, `Position`, `Board ID`, `Voters`, `Comments`, `Checklists`.
 *
 * Defaults for fields Trello does not carry: `priority="medium"`,
 * `difficulty=2`, `kanbanColumn=""`, `chapter=""`, `createdBy=""` (the
 * controller backfills with the importing user), `objectives=[]`,
 * `acceptedAt/completedAt=""` (status will be `"new"` once derived).
 *
 * Every row produces `writeMode = create`.
 */
export class TrelloParser {
  public canParse(header: string[]): boolean {
    return header.includes("Card Name");
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

    const title = at("Card Name");
    if (!title) {
      return {
        ok: false,
        error: {
          row: rowIndex,
          message: "Missing required field: Card Name",
        },
      };
    }

    const members = at("Members");
    const firstMember = members.split(",")[0]?.trim() ?? "";

    const row: ImportRow = {
      rowIndex,
      writeMode: "create",
      shortId: "",
      title,
      description: at("Card Description"),
      zone: at("List"),
      priority: "medium",
      difficulty: 2,
      kanbanColumn: "",
      chapter: "",
      createdBy: "",
      acceptedBy: firstMember,
      completedBy: "",
      createdAt: "",
      acceptedAt: "",
      completedAt: "",
      objectives: [],
    };
    return { ok: true, row, warnings: [] };
  }
}
