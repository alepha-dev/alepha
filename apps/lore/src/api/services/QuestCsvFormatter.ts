export interface ExportRow {
  shortId: number;
  title: string;
  status: "new" | "accepted" | "completed";
  priority: "optional" | "low" | "medium" | "high";
  /**
   * T-shirt size as the stored ordinal, 1 (XS) to 5 (XL). The number rather
   * than the label so the column round-trips through import without a
   * label-to-ordinal table on the server.
   */
  size: number;
  area: string;
  kanbanColumn: string;
  milestone: string;
  createdBy: string;
  acceptedBy: string;
  completedBy: string;
  createdAt: string;
  acceptedAt: string;
  completedAt: string;
  objectives: Array<{ title: string; completed: boolean }>;
  description: string;
}

export const QUEST_CSV_HEADER: ReadonlyArray<keyof ExportRow> = [
  "shortId",
  "title",
  "status",
  "priority",
  "size",
  "area",
  "kanbanColumn",
  "milestone",
  "createdBy",
  "acceptedBy",
  "completedBy",
  "createdAt",
  "acceptedAt",
  "completedAt",
  "objectives",
  "description",
];

/**
 * Encode quest rows into Alepha Lore CSV.
 *
 * Always wraps every value in double quotes (RFC 4180). Embedded `"` becomes
 * `""`. Newlines inside fields are preserved. `objectives` is serialized as a
 * JSON literal.
 *
 * Data cells are also neutralised against CSV injection: a value opening on
 * one of the characters a spreadsheet reads as the start of a formula gets a
 * leading apostrophe, the OWASP recommendation. `AlephaLoreParser` drops one
 * leading apostrophe back off every cell, so the round trip is lossless.
 */
export class QuestCsvFormatter {
  /**
   * Cell openings a spreadsheet reads as the start of a formula, plus the
   * apostrophe itself so that a value which already opens on one survives the
   * round trip instead of losing a character to the import-side strip.
   */
  protected readonly formulaPrefix = /^['=+\-@\t\r]/;

  public format(rows: ExportRow[]): string {
    const lines: string[] = [
      // The header is written verbatim: the names are fixed identifiers, none
      // of them can open a formula, and `canParse` matches on them exactly.
      QUEST_CSV_HEADER.map((c) => this.escape(c)).join(","),
    ];
    for (const row of rows) {
      lines.push(
        QUEST_CSV_HEADER.map((col) => {
          const v = row[col];
          if (col === "objectives")
            return this.escape(this.neutralize(JSON.stringify(v)));
          // A structured cell has to be JSON; `String(v)` would write
          // `[object Object]` into the export.
          return this.escape(
            this.neutralize(
              typeof v === "object" && v !== null
                ? JSON.stringify(v)
                : String(v),
            ),
          );
        }).join(","),
      );
    }
    return `${lines.join("\n")}\n`;
  }

  /**
   * Defuse a cell that Excel or Sheets would otherwise evaluate.
   *
   * Quoting alone does not help: `"=HYPERLINK(...)"` is still a formula once
   * the file is opened. A leading apostrophe is what makes the spreadsheet
   * take the cell as text.
   */
  protected neutralize(value: string): string {
    return this.formulaPrefix.test(value) ? `'${value}` : value;
  }

  protected escape(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
